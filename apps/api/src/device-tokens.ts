import {
  DeviceTokenExchangeRequestSchema,
  type DeviceMetadata,
} from "@tabb/contracts";
import { eq } from "drizzle-orm";
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
  findDeviceByTokenHash(tokenHash: string): Promise<Device | null>;
  findDeviceByDeviceId(deviceId: string): Promise<Device | null>;
  updateDevice(device: Device): Promise<Device>;
  listDevicesByUser(userId: string): Promise<Device[]>;
  createExchangeCode(
    code: string,
    payload: { userId: string; expiresAt: Date },
  ): Promise<void>;
  consumeExchangeCode(code: string): Promise<{ userId: string } | null>;
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
    this.devicesByDeviceId.set(device.deviceId, device);
    return device;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    return this.devicesByHash.get(tokenHash) ?? null;
  }

  async findDeviceByDeviceId(deviceId: string): Promise<Device | null> {
    return this.devicesByDeviceId.get(deviceId) ?? null;
  }

  async updateDevice(device: Device): Promise<Device> {
    const previous = this.devices.get(device.id);
    if (previous) {
      this.devicesByHash.delete(previous.tokenHash);
      this.devicesByDeviceId.delete(previous.deviceId);
    }
    this.devices.set(device.id, device);
    this.devicesByHash.set(device.tokenHash, device);
    this.devicesByDeviceId.set(device.deviceId, device);
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

  async consumeExchangeCode(code: string): Promise<{ userId: string } | null> {
    const record = this.exchangeCodes.get(code);
    if (!record) return null;
    this.exchangeCodes.delete(code);
    if (record.expiresAt < new Date()) return null;
    return { userId: record.userId };
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

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const row = await this.db.query.deviceTokens.findFirst({
      where: eq(deviceTokens.tokenHash, tokenHash),
    });
    return row ? deviceRowToDevice(row) : null;
  }

  async findDeviceByDeviceId(deviceId: string): Promise<Device | null> {
    const row = await this.db.query.deviceTokens.findFirst({
      where: eq(deviceTokens.deviceId, deviceId),
    });
    return row ? deviceRowToDevice(row) : null;
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

  async consumeExchangeCode(code: string): Promise<{ userId: string } | null> {
    const row = await this.db.query.deviceExchangeCodes.findFirst({
      where: eq(deviceExchangeCodes.code, code),
    });
    if (!row) return null;

    await this.db
      .delete(deviceExchangeCodes)
      .where(eq(deviceExchangeCodes.code, code));

    const expiresAt = new Date(row.expiresAt);
    if (expiresAt < new Date()) return null;
    return { userId: row.userId };
  }
}

export type DeviceTokenServiceDependencies = {
  storage?: DeviceTokenStorage;
  exchangeCodeTtlMs?: number;
};

export class DeviceTokenService {
  private storage: DeviceTokenStorage;
  private exchangeCodeTtlMs: number;

  constructor(deps: DeviceTokenServiceDependencies = {}) {
    if (!deps.storage) {
      throw new Error("DeviceTokenService requires a storage implementation");
    }
    this.storage = deps.storage;
    this.exchangeCodeTtlMs = deps.exchangeCodeTtlMs ?? 1000 * 60 * 5;
  }

  async createExchangeCode(userId: string): Promise<string> {
    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.exchangeCodeTtlMs);
    await this.storage.createExchangeCode(code, { userId, expiresAt });
    return code;
  }

  async consumeExchangeCode(code: string): Promise<{ userId: string } | null> {
    return this.storage.consumeExchangeCode(code);
  }

  async createDeviceToken(
    userId: string,
    deviceInfo: DeviceInfo,
  ): Promise<{ token: string; device: Device }> {
    const token = generateOpaqueToken();
    const tokenHash = await hashToken(token);
    const now = new Date();

    const existing = await this.storage.findDeviceByDeviceId(deviceInfo.deviceId);
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

  async verifyDeviceToken(token: string): Promise<Device | null> {
    const tokenHash = await hashToken(token);
    const device = await this.storage.findDeviceByTokenHash(tokenHash);
    if (!device) return null;

    const updated: Device = {
      ...device,
      lastSeenAt: new Date(),
    };
    await this.storage.updateDevice(updated);
    return updated;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<boolean> {
    const device = await this.storage.findDeviceByDeviceId(deviceId);
    if (!device || device.userId !== userId) return false;

    await this.storage.updateDevice({ ...device, revoked: true });
    return true;
  }

  async listDevices(userId: string): Promise<Device[]> {
    return this.storage.listDevicesByUser(userId);
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
