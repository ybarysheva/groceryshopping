import { createHash, randomUUID } from "node:crypto";
import { itemLabel } from "./format";
import { getKV, type Op } from "./kv";
import {
  LIMITS,
  type Add,
  type AddStore,
  type Item,
  type ListData,
  type ListStatus,
  type Note,
  type Round,
} from "./types";
import type { ImportEntry, ItemFields } from "./validate";

// One hash field per item, note and add, so writes to different records never collide.
export const KEYS = {
  items: "g:items",
  notes: "g:notes",
  adds: "g:adds",
  meta: "g:meta",
  rounds: "g:rounds",
} as const;

export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function parseAll<T>(hash: Record<string, string>): T[] {
  const out: T[] = [];
  for (const value of Object.values(hash)) {
    try {
      out.push(JSON.parse(value) as T);
    } catch {
      // Skip a corrupt record rather than failing the whole page.
    }
  }
  return out;
}

export async function readList(): Promise<ListData> {
  const [items, notes, adds, meta] = await getKV().hgetallMany([
    KEYS.items,
    KEYS.notes,
    KEYS.adds,
    KEYS.meta,
  ]);
  const noteMap: Record<string, Note> = {};
  for (const [id, value] of Object.entries(notes)) {
    try {
      noteMap[id] = JSON.parse(value) as Note;
    } catch {}
  }
  return {
    items: parseAll<Item>(items),
    notes: noteMap,
    adds: parseAll<Add>(adds),
    status: meta.status === "final" ? "final" : "draft",
    finalizedAt: meta.status === "final" ? meta.finalizedAt || null : null,
  };
}

async function readItems(): Promise<Item[]> {
  const [items] = await getKV().hgetallMany([KEYS.items]);
  return parseAll<Item>(items);
}

async function requireItem(id: string): Promise<Item> {
  const raw = await getKV().hget(KEYS.items, id);
  if (!raw) throw new UserError("That item was removed from the list.", 404);
  return JSON.parse(raw) as Item;
}

// ---- Notes

export async function setNote(itemId: string, text: string): Promise<Note | null> {
  await requireItem(itemId);
  if (text === "") {
    await getKV().exec([{ type: "hdel", key: KEYS.notes, fields: [itemId] }]);
    return null;
  }
  const note: Note = { text, updatedAt: new Date().toISOString() };
  await getKV().exec([{ type: "hset", key: KEYS.notes, values: { [itemId]: JSON.stringify(note) } }]);
  return note;
}

// ---- Adds

export async function createAdd(input: { id: string; store: AddStore; text: string }): Promise<Add> {
  const kv = getKV();
  // Same id again means a retried request: return what was saved, don't duplicate.
  const existing = await kv.hget(KEYS.adds, input.id);
  if (existing) return JSON.parse(existing) as Add;
  if ((await kv.hlen(KEYS.adds)) >= LIMITS.maxAdds) {
    throw new UserError(`The list already has ${LIMITS.maxAdds} adds. Remove some first.`);
  }
  const add: Add = { ...input, createdAt: new Date().toISOString() };
  await kv.exec([{ type: "hset", key: KEYS.adds, values: { [add.id]: JSON.stringify(add) } }]);
  return add;
}

export async function deleteAdd(id: string): Promise<void> {
  await getKV().exec([{ type: "hdel", key: KEYS.adds, fields: [id] }]);
}

// ---- Items

function sameName(a: Pick<Item, "store" | "name">, b: Pick<Item, "store" | "name">) {
  return a.store === b.store && a.name.toLowerCase() === b.name.toLowerCase();
}

function assertUniqueName(items: Item[], candidate: Pick<Item, "id" | "store" | "name">) {
  if (items.some((i) => i.id !== candidate.id && sameName(i, candidate))) {
    throw new UserError(`There's already a ${candidate.store} item named "${candidate.name}".`, 409);
  }
}

function newItemId() {
  return `i${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function nextSort(items: Item[], store: Item["store"], section: string): number {
  const inSection = items.filter((i) => i.store === store && i.section === section);
  const pool = inSection.length > 0 ? inSection : items.filter((i) => i.store === store);
  return pool.length > 0 ? Math.max(...pool.map((i) => i.sort)) + 1 : 1;
}

function compactItem(item: Item): Item {
  const out: Item = { ...item };
  if (!out.size) delete out.size;
  if (!out.imageUrl) delete out.imageUrl;
  if (!out.price) {
    delete out.price;
    delete out.priceAt;
  }
  return out;
}

/** Keeps priceAt when the price is unchanged; stamps it when the price is new or different. */
function priceStamp(price: string | undefined, before: Item | undefined, now: string): string | undefined {
  if (!price) return undefined;
  return before?.price === price ? (before.priceAt ?? now) : now;
}

export async function createItem(fields: ItemFields): Promise<Item> {
  const items = await readItems();
  if (items.length >= LIMITS.maxItems) {
    throw new UserError(`The list already has ${LIMITS.maxItems} items.`);
  }
  const item = compactItem({
    id: newItemId(),
    store: fields.store,
    section: fields.section,
    name: fields.name,
    size: fields.size,
    imageUrl: fields.imageUrl,
    price: fields.price,
    priceAt: priceStamp(fields.price, undefined, new Date().toISOString()),
    sort: fields.sort ?? nextSort(items, fields.store, fields.section),
    active: fields.active ?? true,
  });
  assertUniqueName(items, item);
  await getKV().exec([{ type: "hset", key: KEYS.items, values: { [item.id]: JSON.stringify(item) } }]);
  return item;
}

/** Merges only the fields sent, so two people editing different fields of one item both stick. */
export async function updateItem(id: string, patch: Partial<ItemFields>): Promise<Item> {
  const items = await readItems();
  const current = items.find((i) => i.id === id);
  if (!current) throw new UserError("That item was removed from the list.", 404);
  const item = compactItem({ ...current, ...patch, id });
  if ("price" in patch) item.priceAt = priceStamp(item.price, current, new Date().toISOString());
  if (!item.priceAt) delete item.priceAt;
  assertUniqueName(items, item);
  await getKV().exec([{ type: "hset", key: KEYS.items, values: { [id]: JSON.stringify(item) } }]);
  return item;
}

export async function deleteItem(id: string): Promise<void> {
  await getKV().exec([
    { type: "hdel", key: KEYS.items, fields: [id] },
    { type: "hdel", key: KEYS.notes, fields: [id] },
  ]);
}

// ---- Import

export type ImportPlan = {
  added: Item[];
  changed: { before: Item; after: Item; fields: string[] }[];
  removed: { item: Item; note: string | null }[];
  unchanged: number;
  /** Fingerprint of the list the plan was made from; Replace is refused if it changed since. */
  basis: string;
};

const COMPARED: (keyof Item)[] = ["store", "section", "name", "size", "imageUrl", "price", "sort", "active"];

function fingerprint(items: Item[]): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id)).map(compactItem);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

function planImport(current: Item[], notes: Record<string, Note>, entries: ImportEntry[]) {
  const byId = new Map(current.map((i) => [i.id, i]));
  const matched = new Set<string>();
  const next: Item[] = [];
  const plan: Omit<ImportPlan, "basis"> = { added: [], changed: [], removed: [], unchanged: 0 };
  const now = new Date().toISOString();

  // Match ids first, so a name match can't steal an item another entry claims by id.
  const idMatches = new Map<ImportEntry, Item>();
  for (const entry of entries) {
    const hit = entry.id ? byId.get(entry.id) : undefined;
    if (hit) {
      idMatches.set(entry, hit);
      matched.add(hit.id);
    }
  }

  for (const entry of entries) {
    let before = idMatches.get(entry);
    if (!before) {
      before = current.find((i) => !matched.has(i.id) && sameName(i, entry));
      if (before) matched.add(before.id);
    }
    const after = compactItem({
      id: before?.id ?? newItemId(),
      store: entry.store,
      section: entry.section,
      name: entry.name,
      size: entry.size,
      imageUrl: entry.imageUrl || before?.imageUrl,
      // Like photos, a price is kept when the pasted entry has none; clear it on /edit.
      price: entry.price || before?.price,
      priceAt: priceStamp(entry.price || before?.price, before, now),
      sort: entry.sort,
      active: entry.active ?? true,
    });
    next.push(after);
    if (!before) {
      plan.added.push(after);
      continue;
    }
    const fields = COMPARED.filter((k) => (before[k] ?? "") !== (after[k] ?? ""));
    if (fields.length > 0) plan.changed.push({ before, after, fields });
    else plan.unchanged++;
  }

  for (const item of current) {
    if (!matched.has(item.id)) plan.removed.push({ item, note: notes[item.id]?.text ?? null });
  }
  return { plan, next };
}

export async function previewImport(entries: ImportEntry[]): Promise<ImportPlan> {
  const data = await readList();
  const { plan } = planImport(data.items, data.notes, entries);
  return { ...plan, basis: fingerprint(data.items) };
}

export async function applyImport(entries: ImportEntry[], basis: string): Promise<ImportPlan> {
  const data = await readList();
  if (fingerprint(data.items) !== basis) {
    throw new UserError("The list changed since you previewed it. Preview again, then Replace.", 409);
  }
  const { plan, next } = planImport(data.items, data.notes, entries);
  const values: Record<string, string> = {};
  for (const item of next) values[item.id] = JSON.stringify(item);
  await getKV().exec([
    { type: "del", key: KEYS.items },
    { type: "hset", key: KEYS.items, values },
    { type: "hdel", key: KEYS.notes, fields: plan.removed.map((r) => r.item.id) },
  ]);
  return { ...plan, basis: fingerprint(next) };
}

// ---- Rounds and status

export async function startRound(): Promise<Round | null> {
  const data = await readList();
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const noteIds = Object.keys(data.notes);
  const round: Round = {
    id: randomUUID(),
    date: new Date().toISOString(),
    notes: noteIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [{ store: item.store, item: itemLabel(item), text: data.notes[id].text }] : [];
    }),
    adds: [...data.adds]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((a) => ({ store: a.store, text: a.text })),
  };
  const hasContent = round.notes.length > 0 || round.adds.length > 0;
  // Delete only the fields that were archived, so a note or add saved this instant survives.
  await getKV().exec([
    ...(hasContent ? [{ type: "lpush", key: KEYS.rounds, value: JSON.stringify(round) } as Op] : []),
    { type: "hdel", key: KEYS.notes, fields: noteIds },
    { type: "hdel", key: KEYS.adds, fields: data.adds.map((a) => a.id) },
    { type: "hset", key: KEYS.meta, values: { status: "draft", finalizedAt: "" } },
  ]);
  return hasContent ? round : null;
}

export async function listRounds(): Promise<Round[]> {
  const raw = await getKV().lrange(KEYS.rounds, 0, 99);
  return raw.flatMap((r) => {
    try {
      return [JSON.parse(r) as Round];
    } catch {
      return [];
    }
  });
}

export async function setStatus(status: ListStatus): Promise<{ status: ListStatus; finalizedAt: string | null }> {
  const finalizedAt = status === "final" ? new Date().toISOString() : null;
  await getKV().exec([
    { type: "hset", key: KEYS.meta, values: { status, finalizedAt: finalizedAt ?? "" } },
  ]);
  return { status, finalizedAt };
}
