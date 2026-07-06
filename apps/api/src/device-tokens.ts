import {
  DeviceTokenExchangeRequestSchema,
  type DeviceMetadata,
} from "@tabb/contracts";
import { z } from "zod";

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

export type DeviceTokenServiceDependencies = {
  storage?: DeviceTokenStorage;
  exchangeCodeTtlMs?: number;
};

type D1Statement = {
  bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<{ success: boolean; error?: string }>;
    all<T = unknown>(): Promise<{ results: T[] }>;
  };
};

type D1DatabaseLike = {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<void>;
};

function asD1Database(db: unknown): D1DatabaseLike {
  return db as D1DatabaseLike;
}

function rowToDevice(row: Record<string, unknown>): Device {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    tokenHash: String(row.token_hash),
    platform: String(row.platform),
    appVersion: String(row.app_version),
    createdAt: new Date(String(row.created_at)),
    lastSeenAt: new Date(String(row.last_seen_at)),
    revoked: row.revoked === true || row.revoked === 1 || row.revoked === "1",
  };
}

/**
 * D1-backed storage for device token hashes and metadata. Exchange codes remain
 * short-lived and should be backed by KV in production; this implementation
 * keeps them in D1 for environments without KV wiring.
 */
export class D1DeviceTokenStorage implements DeviceTokenStorage {
  private db: D1DatabaseLike;

  constructor(db: unknown) {
    this.db = asD1Database(db);
  }

  async ensureTables(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        app_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

      CREATE TABLE IF NOT EXISTS device_exchange_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  async createDevice(record: Omit<Device, "id">): Promise<Device> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO device_tokens (id, user_id, device_id, token_hash, platform, app_version, created_at, last_seen_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        record.userId,
        record.deviceId,
        record.tokenHash,
        record.platform,
        record.appVersion,
        record.createdAt.toISOString(),
        record.lastSeenAt.toISOString(),
        record.revoked ? 1 : 0,
      )
      .run();
    return { ...record, id };
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<Device | null> {
    const row = (await this.db
      .prepare("SELECT * FROM device_tokens WHERE token_hash = ?")
      .bind(tokenHash)
      .first()) as Record<string, unknown> | null;
    return row ? rowToDevice(row) : null;
  }

  async findDeviceByDeviceId(deviceId: string): Promise<Device | null> {
    const row = (await this.db
      .prepare("SELECT * FROM device_tokens WHERE device_id = ?")
      .bind(deviceId)
      .first()) as Record<string, unknown> | null;
    return row ? rowToDevice(row) : null;
  }

  async updateDevice(device: Device): Promise<Device> {
    await this.db
      .prepare(
        `UPDATE device_tokens
         SET last_seen_at = ?, revoked = ?
         WHERE id = ?`,
      )
      .bind(device.lastSeenAt.toISOString(), device.revoked ? 1 : 0, device.id)
      .run();
    return device;
  }

  async listDevicesByUser(userId: string): Promise<Device[]> {
    const result = (await this.db
      .prepare("SELECT * FROM device_tokens WHERE user_id = ?")
      .bind(userId)
      .all()) as { results: Record<string, unknown>[] };
    return result.results.map(rowToDevice);
  }

  async createExchangeCode(
    code: string,
    payload: { userId: string; expiresAt: Date },
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO device_exchange_codes (code, user_id, expires_at) VALUES (?, ?, ?)",
      )
      .bind(code, payload.userId, payload.expiresAt.toISOString())
      .run();
  }

  async consumeExchangeCode(code: string): Promise<{ userId: string } | null> {
    const row = (await this.db
      .prepare("SELECT * FROM device_exchange_codes WHERE code = ?")
      .bind(code)
      .first()) as Record<string, unknown> | null;
    if (!row) return null;

    await this.db
      .prepare("DELETE FROM device_exchange_codes WHERE code = ?")
      .bind(code)
      .run();

    const expiresAt = new Date(String(row.expires_at));
    if (expiresAt < new Date()) return null;
    return { userId: String(row.user_id) };
  }
}

export class DeviceTokenService {
  private storage: DeviceTokenStorage;
  private exchangeCodeTtlMs: number;

  constructor(deps: DeviceTokenServiceDependencies = {}) {
    this.storage = deps.storage ?? new InMemoryDeviceTokenStorage();
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
