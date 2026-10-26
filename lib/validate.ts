import { ADD_STORES, LIMITS, STORES, type AddStore, type Item, type Store } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Collapses whitespace runs so pasted text doesn't carry stray newlines into the order.
function clean(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

export function text(
  v: unknown,
  label: string,
  max: number,
  opts: { required?: boolean } = {},
): Result<string> {
  if (v === undefined || v === null) {
    return opts.required ? fail(`${label} is required.`) : ok("");
  }
  if (typeof v !== "string") return fail(`${label} must be text.`);
  const value = clean(v);
  if (opts.required && value === "") return fail(`${label} can't be empty.`);
  // Count characters, not UTF-16 units, so an emoji counts once.
  const length = [...value].length;
  if (length > max) return fail(`${label} is ${length} characters; the limit is ${max}.`);
  return ok(value);
}

export function store(v: unknown): Result<Store> {
  const match = STORES.find((s) => typeof v === "string" && s.toLowerCase() === clean(v).toLowerCase());
  return match ? ok(match) : fail(`store must be "Amazon Fresh" or "Netcost".`);
}

export function addStore(v: unknown): Result<AddStore> {
  const match = ADD_STORES.find(
    (s) => typeof v === "string" && s.toLowerCase() === clean(v).toLowerCase(),
  );
  return match ? ok(match) : fail(`store must be "Amazon Fresh", "Netcost" or "Either".`);
}

export function imageUrl(v: unknown): Result<string> {
  const t = text(v, "imageUrl", LIMITS.imageUrl);
  if (!t.ok || t.value === "") return t;
  try {
    const url = new URL(t.value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return ok(url.toString());
  } catch {
    return fail("imageUrl must be a web address starting with https://.");
  }
}

export function sortValue(v: unknown): Result<number> {
  if (typeof v === "number" && Number.isFinite(v)) return ok(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return ok(Number(v));
  return fail("sort must be a number.");
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ItemFields = Omit<Item, "id" | "sort" | "active" | "priceAt"> & { sort?: number; active?: boolean };

/**
 * Validates item fields. With `partial`, only the keys present are checked and returned.
 */
export function itemFields(
  input: Record<string, unknown>,
  partial: boolean,
): Result<Partial<ItemFields>> {
  const out: Partial<ItemFields> = {};
  const has = (k: string) => !partial || k in input;

  if (has("store")) {
    const r = store(input.store);
    if (!r.ok) return r;
    out.store = r.value;
  }
  if (has("section")) {
    const r = text(input.section, "section", LIMITS.section, { required: true });
    if (!r.ok) return r;
    out.section = r.value;
  }
  if (has("name")) {
    const r = text(input.name, "name", LIMITS.name, { required: true });
    if (!r.ok) return r;
    out.name = r.value;
  }
  if ("size" in input) {
    const r = text(input.size, "size", LIMITS.size);
    if (!r.ok) return r;
    out.size = r.value;
  }
  if ("price" in input) {
    const r = text(input.price, "price", LIMITS.price);
    if (!r.ok) return r;
    out.price = r.value;
  }
  if ("imageUrl" in input) {
    const r = imageUrl(input.imageUrl);
    if (!r.ok) return r;
    out.imageUrl = r.value;
  }
  if ("sort" in input && input.sort !== null && input.sort !== "") {
    const r = sortValue(input.sort);
    if (!r.ok) return r;
    out.sort = r.value;
  }
  if ("active" in input) {
    if (typeof input.active !== "boolean") return fail("active must be true or false.");
    out.active = input.active;
  }
  return ok(out);
}

export type ImportEntry = {
  id?: string;
  store: Store;
  section: string;
  name: string;
  size?: string;
  imageUrl?: string;
  price?: string;
  sort: number;
  active?: boolean;
};

function describeEntry(raw: unknown, index: number): string {
  const name = isRecord(raw) && typeof raw.name === "string" && raw.name.trim() ? ` ("${clean(raw.name)}")` : "";
  return `Entry ${index + 1}${name}`;
}

/** Parses pasted import text. Returns every problem found, each naming its entry. */
export function importList(raw: string): Result<ImportEntry[]> & { errors?: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "";
    return { ok: false, error: "That isn't valid JSON.", errors: [`That isn't valid JSON. ${detail}`.trim()] };
  }
  if (!Array.isArray(parsed)) {
    const msg = 'The list must be a JSON array, starting with "[" and ending with "]".';
    return { ok: false, error: msg, errors: [msg] };
  }
  if (parsed.length === 0) {
    const msg = "The list is empty. Paste at least one item.";
    return { ok: false, error: msg, errors: [msg] };
  }
  if (parsed.length > LIMITS.maxItems) {
    const msg = `The list has ${parsed.length} items; the limit is ${LIMITS.maxItems}.`;
    return { ok: false, error: msg, errors: [msg] };
  }

  const errors: string[] = [];
  const entries: ImportEntry[] = [];
  const seenIds = new Map<string, number>();
  const seenNames = new Map<string, number>();

  parsed.forEach((rawEntry, index) => {
    const label = describeEntry(rawEntry, index);
    if (!isRecord(rawEntry)) {
      errors.push(`${label}: must be an object like {"store": ..., "section": ..., "name": ...}.`);
      return;
    }
    const fields = itemFields(rawEntry, false);
    if (!fields.ok) {
      errors.push(`${label}: ${fields.error}`);
      return;
    }
    const f = fields.value as ItemFields;
    const entry: ImportEntry = {
      store: f.store,
      section: f.section,
      name: f.name,
      sort: f.sort ?? index + 1,
    };
    if (f.size) entry.size = f.size;
    if (f.imageUrl) entry.imageUrl = f.imageUrl;
    if (f.price) entry.price = f.price;
    if (f.active !== undefined) entry.active = f.active;

    if (rawEntry.id !== undefined && rawEntry.id !== null && rawEntry.id !== "") {
      if (typeof rawEntry.id !== "string" || !ID_PATTERN.test(rawEntry.id)) {
        errors.push(`${label}: id must be letters, numbers, "-" or "_".`);
        return;
      }
      const prev = seenIds.get(rawEntry.id);
      if (prev !== undefined) {
        errors.push(`${label}: id "${rawEntry.id}" is also used by entry ${prev + 1}.`);
        return;
      }
      seenIds.set(rawEntry.id, index);
      entry.id = rawEntry.id;
    }

    const nameKey = `${entry.store}|${entry.name.toLowerCase()}`;
    const prev = seenNames.get(nameKey);
    if (prev !== undefined) {
      errors.push(`${label}: same store and name as entry ${prev + 1}.`);
      return;
    }
    seenNames.set(nameKey, index);
    entries.push(entry);
  });

  if (errors.length > 0) return { ok: false, error: errors[0], errors };
  return ok(entries);
}
