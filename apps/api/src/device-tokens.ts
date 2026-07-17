import {
  DeviceTokenExchangeRequestSchema,
  type DeviceMetadata,
} from "@tab/contracts";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "./db/index.ts";
import { deviceExchangeCodes, deviceTokens } from "./db/schema.ts";

export type Device = {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly revoked: boolean;
};

export type DeviceInfo = {
  readonly deviceId: string;
  readonly platform: string;
  readonly appVersion: string;
};

export interface DeviceTokenStorage {
  createDevice(record: Omit<Device, "id">): Promise<Device>;
  createDeviceWithinLimit?(
    record: Omit<Device, "id">,
    limit: number,
  ): Promise<Device | null>;
  activateDeviceWithinLimit?(
    device: Device,
    limit: number,
  ): Promise<Device | null>;
  findDeviceByTokenHash(tokenHash: string): Promise<Device | null>;
  findDeviceByDeviceId(userId: string, deviceId: string): Promise<Device | null>;
  touchDeviceLastSeen(
    deviceId: string,
    tokenHash: string,
    lastSeenAt: Date,
  ): Promise<boolean>;
  updateDevice(device: Device): Promise<Device>;
  listDevicesByUser(userId: string): Promise<Device[]>;
  createExchangeCode(
    code: string,
    payload: { userId: string; expiresAt: Date },
  ): Promise<void>;
  consumeExchangeCode(code: string): Promise<{ userId: string; expiresAt: Date } | null>;
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Buffer.from(digest).toString("hex");
}

const exchangeCodeSchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(1),
  expiresAt: z.date(),
});

type ExchangeCodeRecord = z.infer<typeof exchangeCodeSchema>;

export class InMemoryDeviceTokenStorage implements DeviceTokenStorage {
  private devices = new Map<string, Device>();
  private devicesByHash = new Map<string, Device>();
  private devicesByDeviceId = new Map<string, Device>();
  private exchangeCodes = new Map<string, ExchangeCodeRecord>();

  async createDevice(record: Omit<Device, "id">): Promise<Device> {
    const device: Device = { ...record, id: crypto.randomUUID() };
    this.devices.set(device.id, device);
    this.devicesByHash.set(device.tokenHash, device);
    this.devicesByDeviceId.set(`${device.userId}:${device.deviceId}`, device);
    return device;
  }

  async createDeviceWithinLimit(
    record: Omit<Device, "id">,
    limit: number,
  ): Promise<Device | null> {
    const active = Array.from(this.devices.values()).filter(
      (device) => device.userId === record.userId && !device.revoked,
    ).length;
    return active >= limit ? null : this.createDevice(record);
  }

  async activateDeviceWithinLimit(
    device: Device,
    limit: number,
  ): Promise<Device | null> {
    const existing = this.devices.get(device.id);
    if (existing && !existing.revoked) return this.updateDevice(device);
    const active = Array.from(this.devices.values()).filter(
      (candidate) => candidate.userId === device.userId && !candidate.revoked,
    ).length;
    return active >= limit ? null : this.updateDevice(device);
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    return this.devicesByHash.get(tokenHash) ?? null;
  }

  async findDeviceByDeviceId(userId: string, deviceId: string): Promise<Device | null> {
    return this.devicesByDeviceId.get(`${userId}:${deviceId}`) ?? null;
  }

  async touchDeviceLastSeen(
    deviceId: string,
    tokenHash: string,
    lastSeenAt: Date,
  ): Promise<boolean> {
    const current = this.devices.get(deviceId);
    if (!current || current.tokenHash !== tokenHash) return false;
    await this.updateDevice({ ...current, lastSeenAt });
    return true;
  }

  async updateDevice(device: Device): Promise<Device> {
    const previous = this.devices.get(device.id);
    if (previous) {
      this.devicesByHash.delete(previous.tokenHash);
      this.devicesByDeviceId.delete(`${previous.userId}:${previous.deviceId}`);
    }
    this.devices.set(device.id, device);
    this.devicesByHash.set(device.tokenHash, device);
    this.devicesByDeviceId.set(`${device.userId}:${device.deviceId}`, device);
    return device;
  }

  async listDevicesByUser(userId: string): Promise<Device[]> {
    return Array.from(this.devices.values()).filter(
      (device) => device.userId === userId,
    );
  }

  async createExchangeCode(
    code: string,
    payload: { userId: string; expiresAt: Date },
  ): Promise<void> {
    this.exchangeCodes.set(code, {
      userId: payload.userId,
      code,
      expiresAt: payload.expiresAt,
    });
  }

  async consumeExchangeCode(code: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const record = this.exchangeCodes.get(code);
    if (!record) return null;
    this.exchangeCodes.delete(code);
    return { userId: record.userId, expiresAt: record.expiresAt };
  }
}

function deviceRowToDevice(row: typeof deviceTokens.$inferSelect): Device {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    tokenHash: row.tokenHash,
    platform: row.platform,
    appVersion: row.appVersion,
    createdAt: new Date(row.createdAt),
    lastSeenAt: new Date(row.lastSeenAt),
    revoked: row.revoked,
  };
}

/**
 * D1-backed storage for device token hashes and metadata. Exchange codes remain
 * short-lived and should be backed by KV in production; this implementation
 * keeps them in D1 for environments without KV wiring.
 */
export class D1DeviceTokenStorage implements DeviceTokenStorage {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async createDevice(record: Omit<Device, "id">): Promise<Device> {
    const id = crypto.randomUUID();
    const device: Device = { ...record, id };
    await this.db.insert(deviceTokens).values({
      id,
      userId: record.userId,
      deviceId: record.deviceId,
      tokenHash: record.tokenHash,
      platform: record.platform,
      appVersion: record.appVersion,
      createdAt: record.createdAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      revoked: record.revoked,
    });
    return device;
  }

  async createDeviceWithinLimit(
    record: Omit<Device, "id">,
    limit: number,
  ): Promise<Device | null> {
    const id = crypto.randomUUID();
    const inserted = await this.db.get<{ id: string }>(sql`
      INSERT INTO device_tokens (
        id, user_id, device_id, token_hash, platform, app_version,
        created_at, last_seen_at, revoked
      )
      SELECT
        ${id}, ${record.userId}, ${record.deviceId}, ${record.tokenHash},
        ${record.platform}, ${record.appVersion},
        ${record.createdAt.toISOString()}, ${record.lastSeenAt.toISOString()}, 0
      WHERE (
        SELECT count(*)
        FROM device_tokens
        WHERE user_id = ${record.userId}
          AND revoked = 0
      ) < ${limit}
      RETURNING id
    `);
    return inserted ? { ...record, id } : null;
  }

  async activateDeviceWithinLimit(
    device: Device,
    limit: number,
  ): Promise<Device | null> {
    const updated = await this.db.get<{ id: string }>(sql`
      UPDATE device_tokens
      SET token_hash = ${device.tokenHash},
          platform = ${device.platform},
          app_version = ${device.appVersion},
          last_seen_at = ${device.lastSeenAt.toISOString()},
          revoked = 0
      WHERE id = ${device.id}
        AND user_id = ${device.userId}
        AND (
          revoked = 0 OR (
            SELECT count(*)
            FROM device_tokens
            WHERE user_id = ${device.userId}
              AND revoked = 0
          ) < ${limit}
        )
      RETURNING id
    `);
    return updated ? device : null;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const row = await this.db.query.deviceTokens.findFirst({
      where: eq(deviceTokens.tokenHash, tokenHash),
    });
    return row ? deviceRowToDevice(row) : null;
  }

  async findDeviceByDeviceId(userId: string, deviceId: string): Promise<Device | null> {
    const row = await this.db.query.deviceTokens.findFirst({
      where: sql`${deviceTokens.userId} = ${userId} AND ${deviceTokens.deviceId} = ${deviceId}`,
    });
    return row ? deviceRowToDevice(row) : null;
  }

  async touchDeviceLastSeen(
    deviceId: string,
    tokenHash: string,
    lastSeenAt: Date,
  ): Promise<boolean> {
    const [updated] = await this.db
      .update(deviceTokens)
      .set({ lastSeenAt: lastSeenAt.toISOString() })
      .where(
        and(
          eq(deviceTokens.id, deviceId),
          eq(deviceTokens.tokenHash, tokenHash),
        ),
      )
      .returning({ id: deviceTokens.id });
    return Boolean(updated);
  }

  async updateDevice(device: Device): Promise<Device> {
    await this.db
      .update(deviceTokens)
      .set({
        userId: device.userId,
        deviceId: device.deviceId,
        tokenHash: device.tokenHash,
        platform: device.platform,
        appVersion: device.appVersion,
        lastSeenAt: device.lastSeenAt.toISOString(),
        revoked: device.revoked,
      })
      .where(eq(deviceTokens.id, device.id));
    return device;
  }

  async listDevicesByUser(userId: string): Promise<Device[]> {
    const rows = await this.db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
    return rows.map(deviceRowToDevice);
  }

  async createExchangeCode(
    code: string,
    payload: { userId: string; expiresAt: Date },
  ): Promise<void> {
    await this.db.insert(deviceExchangeCodes).values({
      code,
      userId: payload.userId,
      expiresAt: payload.expiresAt.toISOString(),
    });
  }

  async consumeExchangeCode(code: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const [row] = await this.db
      .delete(deviceExchangeCodes)
      .where(eq(deviceExchangeCodes.code, code))
      .returning({
        userId: deviceExchangeCodes.userId,
        expiresAt: deviceExchangeCodes.expiresAt,
      });
    return row
      ? { userId: row.userId, expiresAt: new Date(row.expiresAt) }
      : null;
  }
}

export type DeviceTokenServiceDependencies = {
  storage?: DeviceTokenStorage;
  exchangeCodeTtlMs?: number;
  now?: () => Date;
};

export class DeviceTokenService {
  private storage: DeviceTokenStorage;
  private exchangeCodeTtlMs: number;
  private now: () => Date;

  constructor(deps: DeviceTokenServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("DeviceTokenService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.exchangeCodeTtlMs = deps.exchangeCodeTtlMs ?? 1000 * 60 * 5;
    this.now = deps.now ?? (() => new Date());
  }

  async createExchangeCode(userId: string): Promise<string> {
    const code = crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.exchangeCodeTtlMs);
    await this.storage.createExchangeCode(code, { userId, expiresAt });
    return code;
  }

  async consumeExchangeCode(code: string): Promise<{ userId: string } | null> {
    const exchange = await this.storage.consumeExchangeCode(code);
    if (!exchange || exchange.expiresAt < this.now()) return null;
    return { userId: exchange.userId };
  }

  async createDeviceToken(
    userId: string,
    deviceInfo: DeviceInfo,
  ): Promise<{ token: string; device: Device }> {
    const token = generateOpaqueToken();
    const tokenHash = await hashToken(token);
    const now = this.now();

    const existing = await this.storage.findDeviceByDeviceId(userId, deviceInfo.deviceId);
    if (existing) {
      const updated: Device = {
        ...existing,
        userId,
        tokenHash,
        platform: deviceInfo.platform,
        appVersion: deviceInfo.appVersion,
        lastSeenAt: now,
        revoked: false,
      };
      await this.storage.updateDevice(updated);
      return { token, device: updated };
    }

    const device = await this.storage.createDevice({
      userId,
      deviceId: deviceInfo.deviceId,
      tokenHash,
      platform: deviceInfo.platform,
      appVersion: deviceInfo.appVersion,
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
    });

    return { token, device };
  }

  async createDeviceTokenWithinLimit(
    userId: string,
    deviceInfo: DeviceInfo,
    limit: number,
  ): Promise<{ token: string; device: Device } | null> {
    const token = generateOpaqueToken();
    const tokenHash = await hashToken(token);
    const now = this.now();
    const existing = await this.storage.findDeviceByDeviceId(userId, deviceInfo.deviceId);
    if (existing) {
      const updated: Device = {
        ...existing,
        tokenHash,
        platform: deviceInfo.platform,
        appVersion: deviceInfo.appVersion,
        lastSeenAt: now,
        revoked: false,
      };
      const device = existing.revoked
        ? this.storage.activateDeviceWithinLimit
          ? await this.storage.activateDeviceWithinLimit(updated, limit)
          : (await this.activeDeviceCount(userId)) < limit
            ? await this.storage.updateDevice(updated)
            : null
        : await this.storage.updateDevice(updated);
      return device ? { token, device } : null;
    }

    const record = {
      userId,
      deviceId: deviceInfo.deviceId,
      tokenHash,
      platform: deviceInfo.platform,
      appVersion: deviceInfo.appVersion,
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
    };
    const device = this.storage.createDeviceWithinLimit
      ? await this.storage.createDeviceWithinLimit(record, limit)
      : (await this.activeDeviceCount(userId)) < limit
        ? await this.storage.createDevice(record)
        : null;
    return device ? { token, device } : null;
  }

  async verifyDeviceToken(token: string): Promise<Device | null> {
    const tokenHash = await hashToken(token);
    const device = await this.storage.findDeviceByTokenHash(tokenHash);
    if (!device) return null;

    const lastSeenAt = this.now();
    const touched = await this.storage.touchDeviceLastSeen(
      device.id,
      tokenHash,
      lastSeenAt,
    );
    return touched ? { ...device, lastSeenAt } : null;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<boolean> {
    const device = await this.storage.findDeviceByDeviceId(userId, deviceId);
    if (!device) return false;

    await this.storage.updateDevice({ ...device, revoked: true });
    return true;
  }

  async listDevices(userId: string): Promise<Device[]> {
    return this.storage.listDevicesByUser(userId);
  }

  async activeDeviceCount(userId: string): Promise<number> {
    return (await this.listDevices(userId)).filter((device) => !device.revoked)
      .length;
  }

  getDeviceMetadata(device: Device): DeviceMetadata {
    return {
      platform: device.platform,
      appVersion: device.appVersion,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      revoked: device.revoked,
    };
  }
}

export function parseDeviceExchangeBody(body: unknown) {
  return DeviceTokenExchangeRequestSchema.safeParse(body);
}
