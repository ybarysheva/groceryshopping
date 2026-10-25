// First-run seed: loads data/seed.json into the store only if it has never been seeded
// and has no items. Running it again changes nothing. The app never reads seed.json.
//
//   vercel env pull .env.local   # gets the Upstash credentials
//   npm run seed
//
// Without Upstash credentials it seeds the local dev file (.data/local-db.json).

import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Minimal .env.local reader (node 20.11 has no process.loadEnvFile).
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

const seed = JSON.parse(fs.readFileSync(path.join(root, "data", "seed.json"), "utf8"));
const values = Object.fromEntries(seed.map((item) => [item.id, JSON.stringify(item)]));
const seededAt = new Date().toISOString();

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (url && token) {
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const [already, count] = await Promise.all([redis.hget("g:meta", "seededAt"), redis.hlen("g:items")]);
  if (already || count > 0) {
    console.log(`Not seeding: store already has data (seededAt=${already ?? "none"}, items=${count}).`);
  } else {
    const tx = redis.multi();
    tx.hset("g:items", values);
    tx.hset("g:meta", { seededAt });
    await tx.exec();
    console.log(`Seeded ${seed.length} items into Upstash Redis.`);
  }
} else {
  const file = path.join(root, ".data", "local-db.json");
  const data = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { hashes: {}, lists: {} };
  const items = data.hashes["g:items"] ?? {};
  const meta = data.hashes["g:meta"] ?? {};
  if (meta.seededAt || Object.keys(items).length > 0) {
    console.log("Not seeding: local store already has data.");
  } else {
    data.hashes["g:items"] = values;
    data.hashes["g:meta"] = { ...meta, seededAt };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Seeded ${seed.length} items into ${path.relative(root, file)} (no Upstash credentials found).`);
  }
}
