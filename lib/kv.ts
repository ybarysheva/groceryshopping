import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

// A tiny key-value interface: Upstash Redis in production, a JSON file for local dev.
// Values are always strings; callers JSON-encode their own records.

export type Op =
  | { type: "hset"; key: string; values: Record<string, string> }
  | { type: "hdel"; key: string; fields: string[] }
  | { type: "del"; key: string }
  | { type: "lpush"; key: string; value: string };

export interface KV {
  hgetallMany(keys: string[]): Promise<Record<string, string>[]>;
  hget(key: string, field: string): Promise<string | null>;
  hexists(key: string, field: string): Promise<boolean>;
  hlen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  /** Increments a counter and returns the new value; the key expires after `seconds`. */
  incrWithExpiry(key: string, seconds: number): Promise<number>;
  /** Runs all ops atomically (MULTI/EXEC on Redis). */
  exec(ops: Op[]): Promise<void>;
}

// With automaticDeserialization off, Upstash returns HGETALL as a flat [field, value, ...] array.
function toRecord(raw: Record<string, string> | string[] | null): Record<string, string> {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw;
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) out[raw[i]] = raw[i + 1];
  return out;
}

class RedisKV implements KV {
  constructor(private redis: Redis) {}

  async hgetallMany(keys: string[]) {
    const tx = this.redis.multi();
    for (const key of keys) tx.hgetall(key);
    const results = (await tx.exec()) as (Record<string, string> | string[] | null)[];
    return results.map(toRecord);
  }

  async hget(key: string, field: string) {
    return (await this.redis.hget<string>(key, field)) ?? null;
  }

  async hexists(key: string, field: string) {
    return (await this.redis.hexists(key, field)) === 1;
  }

  async hlen(key: string) {
    return this.redis.hlen(key);
  }

  async lrange(key: string, start: number, stop: number) {
    return this.redis.lrange<string>(key, start, stop);
  }

  async incrWithExpiry(key: string, seconds: number) {
    const tx = this.redis.multi();
    tx.incr(key);
    tx.expire(key, seconds);
    const [count] = (await tx.exec()) as [number, number];
    return count;
  }

  async exec(ops: Op[]) {
    if (ops.length === 0) return;
    const tx = this.redis.multi();
    for (const op of ops) {
      if (op.type === "hset") {
        if (Object.keys(op.values).length > 0) tx.hset(op.key, op.values);
      } else if (op.type === "hdel") {
        if (op.fields.length > 0) tx.hdel(op.key, ...op.fields);
      } else if (op.type === "del") tx.del(op.key);
      else tx.lpush(op.key, op.value);
    }
    await tx.exec();
  }
}

type FileData = { hashes: Record<string, Record<string, string>>; lists: Record<string, string[]> };

// Local dev only. Every operation is a synchronous read-modify-write, so it is atomic
// within the single dev server process.
class FileKV implements KV {
  private counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private file: string) {}

  private read(): FileData {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as FileData;
    } catch {
      return { hashes: {}, lists: {} };
    }
  }

  private write(data: FileData) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async hgetallMany(keys: string[]) {
    const data = this.read();
    return keys.map((k) => ({ ...(data.hashes[k] ?? {}) }));
  }

  async hget(key: string, field: string) {
    return this.read().hashes[key]?.[field] ?? null;
  }

  async hexists(key: string, field: string) {
    return (await this.hget(key, field)) !== null;
  }

  async hlen(key: string) {
    return Object.keys(this.read().hashes[key] ?? {}).length;
  }

  async lrange(key: string, start: number, stop: number) {
    const list = this.read().lists[key] ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }

  async incrWithExpiry(key: string, seconds: number) {
    const now = Date.now();
    const entry = this.counters.get(key);
    const count = entry && entry.expiresAt > now ? entry.count + 1 : 1;
    this.counters.set(key, { count, expiresAt: now + seconds * 1000 });
    return count;
  }

  async exec(ops: Op[]) {
    const data = this.read();
    for (const op of ops) {
      if (op.type === "hset") {
        data.hashes[op.key] = { ...(data.hashes[op.key] ?? {}), ...op.values };
      } else if (op.type === "hdel") {
        const hash = data.hashes[op.key];
        if (hash) for (const f of op.fields) delete hash[f];
      } else if (op.type === "del") {
        delete data.hashes[op.key];
        delete data.lists[op.key];
      } else {
        data.lists[op.key] = [op.value, ...(data.lists[op.key] ?? [])];
      }
    }
    this.write(data);
  }
}

export class StorageNotConfiguredError extends Error {}

let kv: KV | undefined;

export function getKV(): KV {
  if (kv) return kv;
  // The Upstash integration on Vercel sets KV_REST_API_*; Upstash's own docs use UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    kv = new RedisKV(new Redis({ url, token, automaticDeserialization: false }));
  } else if (process.env.VERCEL) {
    throw new StorageNotConfiguredError(
      "Storage isn't connected. Connect Upstash Redis to this Vercel project and redeploy.",
    );
  } else {
    kv = new FileKV(path.join(process.cwd(), ".data", "local-db.json"));
  }
  return kv;
}
