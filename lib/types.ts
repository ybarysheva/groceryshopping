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
};

export type ListStatus = "draft" | "final";

export type ListData = {
  items: Item[];
  notes: Record<string, Note>;
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
  imageUrl: 1000,
  maxItems: 500,
  maxAdds: 200,
} as const;
