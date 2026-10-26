import type { Add, AddStore, Item, ListData, Note, Store } from "./types";
import { STORES } from "./types";

// Times are shown in Brooklyn time, whether rendered on the server (UTC) or a phone.
const TIME_ZONE = "America/New_York";

export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export type Section = { name: string; items: Item[] };

// Sections appear in the order of their lowest sort value.
export function groupBySection(items: Item[]): Section[] {
  const map = new Map<string, Item[]>();
  for (const item of sortItems(items)) {
    const list = map.get(item.section);
    if (list) list.push(item);
    else map.set(item.section, [item]);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

export function addsForStore(adds: Add[], store: AddStore): Add[] {
  return adds
    .filter((a) => a.store === store)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function itemLabel(item: Pick<Item, "name" | "size">): string {
  return item.size ? `${item.name}, ${item.size}` : item.name;
}

export function statusLine(status: ListData["status"], finalizedAt: string | null): string {
  return status === "final" && finalizedAt
    ? `final, ${formatDateTime(finalizedAt)}`
    : status;
}

/** Shown items still on this round's order. */
export function orderItems(data: ListData): Item[] {
  return data.items.filter((i) => i.active && !data.removed[i.id]);
}

/** Shown items taken off this round's order, for one store. Hidden items aren't removals. */
export function removedItems(data: ListData, store: AddStore): Item[] {
  return sortItems(data.items.filter((i) => i.store === store && i.active && data.removed[i.id]));
}

// ---- Estimated totals

function weightInLb(size?: string): number | null {
  const m = size?.match(/(\d+(?:\.\d+)?)\s*(lb|oz)\b/i);
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === "oz" ? 1 / 16 : 1);
}

/**
 * Rough cost of one item from its free-text price: the first dollar amount, times the
 * listed weight for "/lb" prices (1 lb when the item has no weight). Null if unpriced.
 */
export function itemEstimate(item: Pick<Item, "price" | "size">): number | null {
  const m = item.price?.match(/\$\s*(\d+(?:\.\d+)?)(\s*\/\s*lb)?/i);
  if (!m) return null;
  const amount = Number(m[1]);
  return m[2] ? amount * (weightInLb(item.size) ?? 1) : amount;
}

export function estimateTotal(items: Item[]): { total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  for (const item of items) {
    const cost = itemEstimate(item);
    if (cost === null) unpriced++;
    else total += cost;
  }
  return { total, unpriced };
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export type ExportOrder = {
  store: AddStore;
  items: {
    store: Store;
    section: string;
    name: string;
    size: string | null;
    price: string | null;
    priceAt: string | null;
    note: string | null;
  }[];
  adds: { store: AddStore; text: string }[];
  /** Taken off this round's order: don't buy these. */
  removed: { store: Store; section: string; name: string; size: string | null }[];
};

export type ExportJson = {
  generatedAt: string;
  status: ListData["status"];
  finalizedAt: string | null;
  orders: ExportOrder[];
};

export function buildExportJson(data: ListData, now = new Date()): ExportJson {
  const active = orderItems(data);
  const orders: ExportOrder[] = [...STORES, "Either" as const].map((store) => ({
    store,
    items: groupBySection(active.filter((i) => i.store === store)).flatMap((s) =>
      s.items.map((i) => ({
        store: i.store,
        section: i.section,
        name: i.name,
        size: i.size ?? null,
        price: i.price ?? null,
        priceAt: i.priceAt ?? null,
        note: data.notes[i.id]?.text ?? null,
      })),
    ),
    adds: addsForStore(data.adds, store).map((a) => ({ store: a.store, text: a.text })),
    removed: removedItems(data, store).map((i) => ({
      store: i.store,
      section: i.section,
      name: i.name,
      size: i.size ?? null,
    })),
  }));
  return {
    generatedAt: now.toISOString(),
    status: data.status,
    finalizedAt: data.finalizedAt,
    orders,
  };
}

export function buildExportText(data: ListData): string {
  const lines = [`Grocery order (status: ${statusLine(data.status, data.finalizedAt)})`];
  const active = orderItems(data);

  for (const store of STORES) {
    const sections = groupBySection(active.filter((i) => i.store === store));
    const adds = addsForStore(data.adds, store);
    const removed = removedItems(data, store);
    if (sections.length === 0 && adds.length === 0 && removed.length === 0) continue;
    lines.push("", store.toUpperCase());
    for (const section of sections) {
      lines.push(section.name);
      for (const item of section.items) {
        const note = data.notes[item.id]?.text;
        const extra = [item.price, note && `note: ${note}`].filter(Boolean).join("; ");
        lines.push(`- ${itemLabel(item)}${extra ? ` (${extra})` : ""}`);
      }
    }
    if (adds.length > 0) {
      lines.push("Added");
      for (const add of adds) lines.push(`- ${add.text}`);
    }
    if (removed.length > 0) {
      lines.push("Removed (don't order)");
      for (const item of removed) lines.push(`- ${itemLabel(item)}`);
    }
  }

  const either = addsForStore(data.adds, "Either");
  if (either.length > 0) {
    lines.push("", "EITHER STORE");
    for (const add of either) lines.push(`- ${add.text}`);
  }
  return lines.join("\n") + "\n";
}

export function buildClaudeMessage(data: ListData, origin: string, orderText: string): string {
  const status =
    data.status === "final" && data.finalizedAt
      ? `final (marked ${formatDateTime(data.finalizedAt)})`
      : "draft (not marked final yet)";
  return [
    "Please place my grocery orders from this list.",
    `Status: ${status}`,
    `Live list: ${origin}/api/export?format=text`,
    "",
    orderText.trimEnd(),
    "",
  ].join("\n");
}

export type StoreSummary = {
  store: AddStore;
  notes: { item: Item; note: Note }[];
  adds: Add[];
  removed: Item[];
};

// Notes on items still on the order, adds and removals, grouped by store. Used by the "Notes & adds" tab.
export function buildSummary(data: ListData): StoreSummary[] {
  return [...STORES, "Either" as const]
    .map((store) => ({
      store,
      notes: sortItems(
        orderItems(data).filter((i) => i.store === store && data.notes[i.id]),
      ).map((item) => ({ item, note: data.notes[item.id] })),
      adds: addsForStore(data.adds, store),
      removed: removedItems(data, store),
    }))
    .filter((s) => s.notes.length > 0 || s.adds.length > 0 || s.removed.length > 0);
}

export function summaryText(summary: StoreSummary[]): string {
  return (
    summary
      .map((s) =>
        [
          s.store === "Either" ? "Either store" : s.store,
          ...s.notes.map((n) => `Note: ${itemLabel(n.item)} - ${n.note.text}`),
          ...s.adds.map((a) => `Add: ${a.text}`),
          ...s.removed.map((i) => `Remove: ${itemLabel(i)}`),
        ].join("\n"),
      )
      .join("\n\n") + "\n"
  );
}
