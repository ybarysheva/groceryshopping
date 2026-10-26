"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { addsForStore, groupBySection, itemLabel } from "@/lib/format";
import { ADD_STORES, LIMITS, type Add, type AddStore, type Item, type ListData, type Note, type Store } from "@/lib/types";
import { LoadState, NotesSummary, SaveStatus, Thumb, ToastView } from "./ui";
import { api, uuid, useList } from "./useList";

type Tab = Store | "notes";

const TAB_LABEL: Record<Tab, string> = {
  "Amazon Fresh": "Amazon Fresh",
  Netcost: "Netcost",
  notes: "Notes & adds",
};

const SHORT_STORE: Record<AddStore, string> = {
  "Amazon Fresh": "Amazon",
  Netcost: "Netcost",
  Either: "Either",
};

export default function ListPage() {
  const { data, loadError, retry, saveState, toast, setToast, showToast, mutate } = useList();
  const [tab, setTab] = useState<Tab>("Amazon Fresh");
  const [addStore, setAddStore] = useState<AddStore>("Amazon Fresh");
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const selectTab = (next: Tab) => {
    setTab(next);
    if (next !== "notes") setAddStore(next);
  };

  const onCopied = useCallback((label: string) => showToast("info", `${label} copied.`), [showToast]);

  const counts = useMemo(() => {
    if (!data) return null;
    const active = data.items.filter((i) => i.active);
    const either = data.adds.filter((a) => a.store === "Either").length;
    const per = (s: Store) =>
      active.filter((i) => i.store === s).length + data.adds.filter((a) => a.store === s).length + either;
    const notes = active.filter((i) => data.notes[i.id]).length;
    return { "Amazon Fresh": per("Amazon Fresh"), Netcost: per("Netcost"), notes: notes + data.adds.length };
  }, [data]);

  // ---- Writes

  const addItem = async (text: string, store: AddStore): Promise<boolean> => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return false;
    if ([...trimmed].length > LIMITS.add) {
      showToast("error", `Keep it under ${LIMITS.add} characters.`);
      return false;
    }
    const add: Add = { id: uuid(), store, text: trimmed, createdAt: new Date().toISOString() };
    const visible = tab === "notes" || store === "Either" || store === tab;
    const ok = await mutate({
      apply: (d) => ({ ...d, adds: [...d.adds, add] }),
      undo: (d) => ({ ...d, adds: d.adds.filter((a) => a.id !== add.id) }),
      request: () => api("POST", "/api/adds", { id: add.id, store, text: trimmed }),
    });
    if (ok && !visible) showToast("info", `Added to ${store}.`);
    return true;
  };

  const removeAdd = (add: Add) =>
    mutate({
      apply: (d) => ({ ...d, adds: d.adds.filter((a) => a.id !== add.id) }),
      undo: (d) => (d.adds.some((a) => a.id === add.id) ? d : { ...d, adds: [...d.adds, add] }),
      request: () => api("DELETE", `/api/adds/${add.id}`),
    });

  // Removing hides the item (same as Hide on /edit), so a mis-tap can be undone and
  // the item's photo, note and place in the list are kept.
  const setActive = (item: Item, active: boolean) =>
    mutate({
      apply: (d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, active } : i)) }),
      undo: (d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, active: !active } : i)) }),
      request: () => api("PATCH", `/api/items/${item.id}`, { active }),
    });

  const removeItem = async (item: Item) => {
    if (editingNote === item.id) setEditingNote(null);
    const ok = await setActive(item, false);
    if (ok) showToast("info", `Removed ${item.name}.`, { label: "Undo", run: () => void setActive(item, true) });
  };

  const saveNote = (item: Item, text: string) => {
    const previous = data?.notes[item.id];
    const note: Note = { text, updatedAt: new Date().toISOString() };
    setEditingNote(null);
    return mutate({
      apply: (d) => ({ ...d, notes: withNote(d.notes, item.id, text ? note : undefined) }),
      undo: (d) => ({ ...d, notes: withNote(d.notes, item.id, previous) }),
      request: () =>
        text ? api("PUT", `/api/notes/${item.id}`, { text }) : api("DELETE", `/api/notes/${item.id}`),
    });
  };

  return (
    <>
      <main className="wrap page">
        <header className="header">
          <div>
            <h1 className="title">Groceries</h1>
            <p className="lede">Leave a note on anything, and add what I forgot.</p>
          </div>
          <SaveStatus state={saveState} />
        </header>

        <section className="card add-box" aria-label="Add something">
          <AddForm variant="top" store={addStore} onStoreChange={setAddStore} onAdd={addItem} />
        </section>

        <div className="tabs" role="tablist" aria-label="Lists">
          {(["Amazon Fresh", "Netcost", "notes"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`tab-${slug(t)}`}
              aria-selected={tab === t}
              aria-controls={`panel-${slug(t)}`}
              className="tab"
              onClick={() => selectTab(t)}
            >
              {TAB_LABEL[t]}
              {counts && <span className="badge">{counts[t]}</span>}
            </button>
          ))}
        </div>

        <div
          className="panel"
          role="tabpanel"
          id={`panel-${slug(tab)}`}
          aria-labelledby={`tab-${slug(tab)}`}
        >
          {!data ? (
            <LoadState error={loadError} onRetry={retry} />
          ) : tab === "notes" ? (
            <NotesSummary data={data} onCopied={onCopied} />
          ) : (
            <StoreList
              data={data}
              store={tab}
              editingNote={editingNote}
              onEditNote={setEditingNote}
              onSaveNote={saveNote}
              onRemoveAdd={removeAdd}
              onRemoveItem={removeItem}
            />
          )}
        </div>
      </main>

      <div className="bar">
        <div className="wrap" style={{ padding: 0 }}>
          <AddForm variant="bar" store={addStore} onStoreChange={setAddStore} onAdd={addItem} />
        </div>
      </div>

      <ToastView toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

function slug(t: Tab) {
  return t.toLowerCase().replace(/[^a-z]+/g, "-");
}

function withNote(notes: Record<string, Note>, id: string, note: Note | undefined) {
  const next = { ...notes };
  if (note) next[id] = note;
  else delete next[id];
  return next;
}

// ---- Add form (top box and bottom bar share the store choice)

function AddForm({
  variant,
  store,
  onStoreChange,
  onAdd,
}: {
  variant: "top" | "bar";
  store: AddStore;
  onStoreChange: (s: AddStore) => void;
  onAdd: (text: string, store: AddStore) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text;
    if (!value.trim()) return;
    setText("");
    const accepted = await onAdd(value, store);
    if (!accepted) setText(value);
  };

  if (variant === "bar") {
    return (
      <form onSubmit={submit} aria-label="Add something (bottom bar)">
        <label htmlFor={`${id}-text`} className="sr-only">
          Add something
        </label>
        <input
          id={`${id}-text`}
          className="input"
          placeholder="Add something"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
        />
        <label htmlFor={`${id}-store`} className="sr-only">
          Store
        </label>
        <select
          id={`${id}-store`}
          className="select"
          value={store}
          onChange={(e) => onStoreChange(e.target.value as AddStore)}
        >
          {ADD_STORES.map((s) => (
            <option key={s} value={s}>
              {SHORT_STORE[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-accent">
          Add
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={`${id}-text`} className="sr-only">
        Add something
      </label>
      <div className="add-line">
        <input
          id={`${id}-text`}
          className="input"
          placeholder="Add something"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="submit" className="btn btn-accent">
          Add
        </button>
      </div>
      <fieldset className="segmented">
        <legend className="sr-only">Store</legend>
        {ADD_STORES.map((s) => (
          <label key={s}>
            <input
              type="radio"
              name={`${id}-store`}
              value={s}
              checked={store === s}
              onChange={() => onStoreChange(s)}
            />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>
    </form>
  );
}

// ---- Store tab

function StoreList({
  data,
  store,
  editingNote,
  onEditNote,
  onSaveNote,
  onRemoveAdd,
  onRemoveItem,
}: {
  data: ListData;
  store: Store;
  editingNote: string | null;
  onEditNote: (id: string | null) => void;
  onSaveNote: (item: Item, text: string) => void;
  onRemoveAdd: (add: Add) => void;
  onRemoveItem: (item: Item) => void;
}) {
  const sections = groupBySection(data.items.filter((i) => i.store === store && i.active));
  const adds = [...addsForStore(data.adds, store), ...addsForStore(data.adds, "Either")];

  return (
    <div className="stack">
      {adds.length > 0 && (
        <section className="card" aria-labelledby="added-head">
          <div className="card-head">
            <h2 id="added-head">Added</h2>
            <span className="mono muted">{adds.length}</span>
          </div>
          <ul className="rows">
            {adds.map((a) => (
              <li className="row-text" key={a.id}>
                <p className="row-name">
                  {a.text}
                  {a.store === "Either" && <span className="tag">Either store</span>}
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onRemoveAdd(a)}
                  aria-label={`Remove ${a.text}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.length === 0 && adds.length === 0 && (
        <div className="card empty">
          <p>Nothing on the {store} list yet.</p>
        </div>
      )}

      {sections.map((section) => (
        <section className="card" key={section.name} aria-label={section.name}>
          <div className="card-head">
            <h2>{section.name}</h2>
            <span className="mono muted">{section.items.length}</span>
          </div>
          <ul className="rows">
            {section.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                note={data.notes[item.id]}
                editing={editingNote === item.id}
                onEdit={() => onEditNote(item.id)}
                onCancel={() => onEditNote(null)}
                onSave={(text) => onSaveNote(item, text)}
                onRemove={() => onRemoveItem(item)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  note,
  editing,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  item: Item;
  note?: Note;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onRemove: () => void;
}) {
  return (
    <li>
      <div className="row">
        <Thumb src={item.imageUrl} name={item.name} />
        <div className="row-main">
          <p className="row-name">{item.name}</p>
          {item.size && <p className="row-sub">{item.size}</p>}
          {note && !editing && (
            <div className="note-callout">
              <p>
                <span className="sr-only">Note: </span>
                {note.text}
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn-sm" onClick={onEdit} aria-label={`Edit note on ${item.name}`}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => onSave("")}
                  aria-label={`Clear note on ${item.name}`}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="row-actions">
          {!note && !editing && (
            <button type="button" className="btn btn-sm" onClick={onEdit} aria-label={`Note on ${item.name}`}>
              Note
            </button>
          )}
          <button type="button" className="btn-remove" onClick={onRemove} aria-label={`Remove ${item.name}`}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      {editing && (
        <NoteEditor label={`Note on ${itemLabel(item)}`} initial={note?.text ?? ""} onCancel={onCancel} onSave={onSave} />
      )}
    </li>
  );
}

function NoteEditor({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  // The draft lives here, so background refreshes never overwrite what's being typed.
  const [text, setText] = useState(initial);
  const id = useId();
  const length = [...text.trim()].length;
  const tooLong = length > LIMITS.note;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tooLong) return;
    onSave(text.replace(/\s+/g, " ").trim());
  };

  return (
    <form className="note-editor" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="get strawberry instead, get two..."
        rows={3}
        autoFocus
        aria-describedby={`${id}-count`}
        aria-invalid={tooLong}
      />
      <div className="field-foot">
        <span id={`${id}-count`} className={`mono ${tooLong ? "over-limit" : "muted"}`} aria-live="polite">
          {tooLong ? `Too long: ${length} of ${LIMITS.note} characters` : `${length}/${LIMITS.note}`}
        </span>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-accent" disabled={tooLong}>
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

