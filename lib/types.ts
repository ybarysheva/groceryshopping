export const STORES = ["Amazon Fresh", "Netcost"] as const;
export const ADD_STORES = ["Amazon Fresh", "Netcost", "Either"] as const;

export type Store = (typeof STORES)[number];
export type AddStore = (typeof ADD_STORES)[number];

export type Item = {
  id: string;
  store: Store;
  section: string;
  name: string;
  size?: string;
  imageUrl?: string;
  /** Free text, e.g. "$5.49" or "$7.69/lb". */
  price?: string;
  /** When the price was last set (ISO). Stamped by the server, never sent by clients. */
  priceAt?: string;
  active: boolean;
  sort: number;
};

export type Note = {
  text: string;
  updatedAt: string;
};

export type Add = {
  id: string;
  store: AddStore;
  text: string;
  createdAt: string;
};

export type Round = {
  id: string;
  date: string;
  notes: { store: Store; item: string; text: string }[];
  adds: { store: AddStore; text: string }[];
  /** Missing on rounds saved before removals were tracked. */
  removed?: { store: Store; item: string }[];
};

/** An item taken off this round's order (the × on the shared page). Cleared by a new round. */
export type Removal = {
  removedAt: string;
};

export type ListStatus = "draft" | "final";

export type ListData = {
  items: Item[];
  notes: Record<string, Note>;
  removed: Record<string, Removal>;
  adds: Add[];
  status: ListStatus;
  finalizedAt: string | null;
};

export const LIMITS = {
  note: 200,
  add: 80,
  name: 120,
  section: 60,
  size: 60,
  price: 40,
  imageUrl: 1000,
  maxItems: 500,
  maxAdds: 200,
} as const;
