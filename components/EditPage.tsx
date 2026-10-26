"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import {
  buildClaudeMessage,
  buildExportText,
  formatDate,
  formatDateTime,
  formatShortDate,
  groupBySection,
  itemLabel,
  sortItems,
} from "@/lib/format";
import { LIMITS, STORES, type Item, type ListData, type Round, type Store } from "@/lib/types";
import { CopyFallback, LoadState, NotesSummary, SaveStatus, Thumb, ToastView, useCopy } from "./ui";
import { api, useList, uuid } from "./useList";

type ImportPlan = {
  added: Item[];
  changed: { before: Item; after: Item; fields: (keyof Item)[] }[];
  removed: { item: Item; note: string | null }[];
  unchanged: number;
  basis: string;
};

type ItemDraft = {
  name: string;
  store: Store;
  section: string;
  size: string;
  price: string;
  imageUrl: string;
  sort: string;
  active: boolean;
};

const IMPORT_EXAMPLE = `[
  {"store": "Amazon Fresh", "section": "Produce", "name": "Bananas"},
  {"store": "Netcost", "section": "Deli", "name": "Doktorskaya", "size": "about 0.5 lb"}
]`;

function siteOrigin() {
  const prod = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : window.location.origin;
}

function draftFrom(item: Item): ItemDraft {
  return {
    name: item.name,
    store: item.store,
    section: item.section,
    size: item.size ?? "",
    price: item.price ?? "",
    imageUrl: item.imageUrl ?? "",
    sort: String(item.sort),
    active: item.active,
  };
}

function listAsJson(items: Item[]): string {
  const ordered = STORES.flatMap((s) => sortItems(items.filter((i) => i.store === s)));
  return JSON.stringify(
    ordered.map((i) => ({
      id: i.id,
      store: i.store,
      section: i.section,
      name: i.name,
      ...(i.size ? { size: i.size } : {}),
      ...(i.price ? { price: i.price } : {}),
      ...(i.imageUrl ? { imageUrl: i.imageUrl } : {}),
      sort: i.sort,
      active: i.active,
    })),
    null,
    2,
  );
}

export default function EditPage() {
  const list = useList();
  const { data, setData, loadError, retry, saveState, toast, setToast, showToast, mutate, track } = list;
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [roundsError, setRoundsError] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: ItemDraft } | null>(null);

  const onCopied = useCallback((label: string) => showToast("info", `${label} copied.`), [showToast]);
  const claudeCopy = useCopy(onCopied);
  const jsonCopy = useCopy(onCopied);

  const loadRounds = useCallback(async () => {
    const res = await api<{ rounds: Round[] }>("GET", "/api/rounds");
    if (res.ok) {
      setRounds(res.data.rounds);
      setRoundsError(false);
    } else setRoundsError(true);
  }, []);

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  // ---- Item writes

  const replaceItem = (d: ListData, item: Item) => ({
    ...d,
    items: d.items.map((i) => (i.id === item.id ? item : i)),
  });

  const patchItem = (item: Item, patch: Partial<Item>) => {
    const next: Item = { ...item, ...patch };
    if (!next.size) delete next.size;
    if (!next.imageUrl) delete next.imageUrl;
    if ("price" in patch) next.priceAt = next.price ? new Date().toISOString() : undefined;
    if (!next.price) {
      delete next.price;
      delete next.priceAt;
    }
    return mutate({
      apply: (d) => replaceItem(d, next),
      undo: (d) => replaceItem(d, item),
      request: () => api("PATCH", `/api/items/${item.id}`, patch),
    });
  };

  const saveDraft = async (item: Item, draft: ItemDraft) => {
    const patch: Record<string, unknown> = {};
    const current = draftFrom(item);
    (Object.keys(draft) as (keyof ItemDraft)[]).forEach((k) => {
      if (draft[k] !== current[k]) patch[k] = k === "sort" ? Number(draft.sort) : draft[k];
    });
    setEditing(null);
    if (Object.keys(patch).length === 0) return;
    if ("sort" in patch && !Number.isFinite(patch.sort)) {
      showToast("error", "Sort must be a number.");
      setEditing({ id: item.id, draft });
      return;
    }
    const ok = await patchItem(item, patch as Partial<Item>);
    // Reopen with what was typed, so a rejected save (say, a duplicate name) isn't lost.
    if (!ok) setEditing({ id: item.id, draft });
  };

  const removeItem = (item: Item) => {
    const note = data?.notes[item.id];
    setEditing(null);
    return mutate({
      apply: (d) => {
        const notes = { ...d.notes };
        delete notes[item.id];
        return { ...d, items: d.items.filter((i) => i.id !== item.id), notes };
      },
      undo: (d) => ({
        ...d,
        items: [...d.items, item],
        notes: note ? { ...d.notes, [item.id]: note } : d.notes,
      }),
      request: () => api("DELETE", `/api/items/${item.id}`),
    });
  };

  const createItem = async (draft: ItemDraft): Promise<boolean> => {
    const tempId = `tmp-${uuid()}`;
    const temp: Item = {
      id: tempId,
      store: draft.store,
      section: draft.section.trim(),
      name: draft.name.trim(),
      size: draft.size.trim() || undefined,
      imageUrl: draft.imageUrl.trim() || undefined,
      price: draft.price.trim() || undefined,
      sort: draft.sort.trim() ? Number(draft.sort) : 1e9,
      active: draft.active,
    };
    return mutate<{ item: Item }>({
      apply: (d) => ({ ...d, items: [...d.items, temp] }),
      undo: (d) => ({ ...d, items: d.items.filter((i) => i.id !== tempId) }),
      request: () =>
        api("POST", "/api/items", {
          store: draft.store,
          section: draft.section,
          name: draft.name,
          size: draft.size,
          imageUrl: draft.imageUrl,
          price: draft.price,
          sort: draft.sort.trim() === "" ? undefined : draft.sort,
          active: draft.active,
        }),
      onSuccess: ({ item }) =>
        setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === tempId ? item : i)) } : d)),
    });
  };

  const setFinal = (final: boolean) => {
    if (!data) return;
    const before = { status: data.status, finalizedAt: data.finalizedAt };
    return mutate<{ status: ListData["status"]; finalizedAt: string | null }>({
      apply: (d) => ({ ...d, status: final ? "final" : "draft", finalizedAt: final ? new Date().toISOString() : null }),
      undo: (d) => ({ ...d, ...before }),
      request: () => api("PUT", "/api/status", { status: final ? "final" : "draft" }),
      onSuccess: (res) => setData((d) => (d ? { ...d, ...res } : d)),
    });
  };

  const startRound = async () => {
    if (!data) return;
    const before = { notes: data.notes, adds: data.adds, status: data.status, finalizedAt: data.finalizedAt };
    const ok = await mutate({
      apply: (d) => ({ ...d, notes: {}, adds: [], status: "draft", finalizedAt: null }),
      undo: (d) => ({ ...d, ...before }),
      request: () => api("POST", "/api/rounds"),
    });
    if (ok) {
      showToast("info", "New round started.");
      void loadRounds();
    }
    return ok;
  };

  const copyForClaude = () => {
    if (!data) return;
    claudeCopy.copy(buildClaudeMessage(data, siteOrigin(), buildExportText(data)), "Message for Claude");
  };

  return (
    <>
      <main className="wrap page page-edit">
        <header className="header">
          <div>
            <h1 className="title">Edit list</h1>
            <p className="lede">
              {data ? (
                data.status === "final" && data.finalizedAt ? (
                  <>
                    <span className="status-pill final">Final</span> marked {formatDateTime(data.finalizedAt)}
                  </>
                ) : (
                  <>
                    <span className="status-pill">Draft</span> not marked final yet
                  </>
                )
              ) : (
                " "
              )}
            </p>
          </div>
          <SaveStatus state={saveState} />
        </header>

        <nav className="jump" aria-label="Sections on this page">
          <a className="btn btn-sm" href="#order">Order</a>
          <a className="btn btn-sm" href="#items">Items</a>
          <a className="btn btn-sm" href="#import">Import</a>
          <a className="btn btn-sm" href="#rounds">Rounds</a>
          <Link className="btn btn-sm btn-quiet" href="/">
            Open the shared page
          </Link>
        </nav>

        {!data ? (
          <div style={{ marginTop: 24 }}>
            <LoadState error={loadError} onRetry={retry} />
          </div>
        ) : (
          <>
            <h2 className="section-title" id="order">
              Order
            </h2>
            <section className="card card-pad stack" aria-label="Order status">
              <div className="switch-row">
                <div>
                  <p className="row-name" id="final-label">
                    Mark as final
                  </p>
                  <p className="row-sub">Tells Claude the list is ready to order.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={data.status === "final"}
                  aria-labelledby="final-label"
                  onClick={() => setFinal(data.status !== "final")}
                />
              </div>
              <div>
                <div className="btn-row">
                  <button type="button" className="btn btn-accent" onClick={copyForClaude}>
                    Copy for Claude
                  </button>
                  <a className="btn btn-sm btn-quiet" href="/api/export?format=text" target="_blank" rel="noreferrer">
                    View export text
                  </a>
                </div>
                <CopyFallback fallback={claudeCopy.fallback} onClose={claudeCopy.dismiss} />
              </div>
            </section>

            <h2 className="section-title">Notes and adds</h2>
            <NotesSummary data={data} onCopied={onCopied} headingLevel={3} />

            <h2 className="section-title" id="items">
              Items
            </h2>
            <ItemsEditor
              data={data}
              editing={editing}
              onStartEdit={(item) => setEditing({ id: item.id, draft: draftFrom(item) })}
              onDraftChange={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
              onCancel={() => setEditing(null)}
              onSave={saveDraft}
              onDelete={removeItem}
              onToggleActive={(item) => patchItem(item, { active: !item.active })}
            />

            <h2 className="section-title">Add item</h2>
            <AddItemForm data={data} onCreate={createItem} />

            <h2 className="section-title" id="import">
              Import list
            </h2>
            <ImportPanel
              track={track}
              onReplaced={() => showToast("info", "List replaced.")}
              copyJson={() => jsonCopy.copy(listAsJson(data.items), "Current list as JSON")}
              jsonFallback={<CopyFallback fallback={jsonCopy.fallback} onClose={jsonCopy.dismiss} />}
            />

            <h2 className="section-title" id="rounds">
              Start a new round
            </h2>
            <NewRound data={data} onConfirm={startRound} />

            <h2 className="section-title">Past rounds</h2>
            <PastRounds rounds={rounds} error={roundsError} onRetry={loadRounds} />
          </>
        )}
      </main>
      <ToastView toast={toast} onClose={() => setToast(null)} low />
    </>
  );
}

// ---- Items

function ItemsEditor({
  data,
  editing,
  onStartEdit,
  onDraftChange,
  onCancel,
  onSave,
  onDelete,
  onToggleActive,
}: {
  data: ListData;
  editing: { id: string; draft: ItemDraft } | null;
  onStartEdit: (item: Item) => void;
  onDraftChange: (draft: ItemDraft) => void;
  onCancel: () => void;
  onSave: (item: Item, draft: ItemDraft) => void;
  onDelete: (item: Item) => void;
  onToggleActive: (item: Item) => void;
}) {
  return (
    <>
      {STORES.map((store) => {
        const sections = groupBySection(data.items.filter((i) => i.store === store));
        return (
          <div key={store}>
            <h3 className="store-title">{store}</h3>
            {sections.length === 0 && (
              <div className="card empty">
                <p>No {store} items.</p>
              </div>
            )}
            <div className="stack">
              {sections.map((section) => (
                <section className="card" key={section.name} aria-label={`${store}: ${section.name}`}>
                  <div className="card-head">
                    <h4 style={{ margin: 0, fontFamily: "var(--heading)", fontSize: 18 }}>{section.name}</h4>
                    <span className="mono muted">{section.items.length}</span>
                  </div>
                  <ul className="rows">
                    {section.items.map((item) => {
                      const isEditing = editing?.id === item.id;
                      const note = data.notes[item.id];
                      return (
                        <li key={item.id} className={item.active ? "" : "row-hidden"}>
                          <div className="row">
                            <Thumb src={item.imageUrl} name={item.name} />
                            <div className="row-main">
                              <p className="row-name">
                                {item.name}
                                {!item.active && <span className="tag">Hidden</span>}
                              </p>
                              <p className="row-sub">
                                {item.size ? `${item.size} · ` : ""}
                                {item.price && (
                                  <>
                                    <span className="price">{item.price}</span>
                                    {item.priceAt ? ` as of ${formatShortDate(item.priceAt)}` : ""}
                                    {" · "}
                                  </>
                                )}
                                <span className="mono">sort {item.sort}</span>
                              </p>
                              {note && (
                                <div className="note-callout">
                                  <p>
                                    <span className="sr-only">Note: </span>
                                    {note.text}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-quiet"
                                onClick={() => onToggleActive(item)}
                                aria-label={`${item.active ? "Hide" : "Show"} ${item.name}`}
                              >
                                {item.active ? "Hide" : "Show"}
                              </button>
                              {!isEditing && (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => onStartEdit(item)}
                                  aria-label={`Edit ${item.name}`}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                          {isEditing && editing && (
                            <ItemEditor
                              item={item}
                              draft={editing.draft}
                              sections={sectionNames(data, editing.draft.store)}
                              onChange={onDraftChange}
                              onCancel={onCancel}
                              onSave={() => onSave(item, editing.draft)}
                              onDelete={() => onDelete(item)}
                              hasNote={Boolean(note)}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function sectionNames(data: ListData, store: Store): string[] {
  return groupBySection(data.items.filter((i) => i.store === store)).map((s) => s.name);
}

function ItemFieldsForm({
  draft,
  sections,
  onChange,
}: {
  draft: ItemDraft;
  sections: string[];
  onChange: (draft: ItemDraft) => void;
}) {
  const id = useId();
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="form-grid">
      <div className="field full">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          className="input"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={LIMITS.name}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-store`}>Store</label>
        <select
          id={`${id}-store`}
          className="select"
          value={draft.store}
          onChange={(e) => set("store", e.target.value as Store)}
        >
          {STORES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-section`}>Section</label>
        <input
          id={`${id}-section`}
          className="input"
          value={draft.section}
          onChange={(e) => set("section", e.target.value)}
          list={`${id}-sections`}
          maxLength={LIMITS.section}
          required
        />
        <datalist id={`${id}-sections`}>
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor={`${id}-size`}>Size (optional)</label>
        <input
          id={`${id}-size`}
          className="input"
          value={draft.size}
          onChange={(e) => set("size", e.target.value)}
          placeholder="about 2 lb"
          maxLength={LIMITS.size}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-price`}>Price (optional)</label>
        <input
          id={`${id}-price`}
          className="input"
          value={draft.price}
          onChange={(e) => set("price", e.target.value)}
          placeholder="$5.49 or $7.69/lb"
          maxLength={LIMITS.price}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-sort`}>Sort</label>
        <input
          id={`${id}-sort`}
          className="input"
          value={draft.sort}
          onChange={(e) => set("sort", e.target.value)}
          inputMode="decimal"
          placeholder="auto"
        />
      </div>
      <div className="field full">
        <label htmlFor={`${id}-image`}>Image URL (optional)</label>
        <input
          id={`${id}-image`}
          className="input"
          value={draft.imageUrl}
          onChange={(e) => set("imageUrl", e.target.value)}
          type="url"
          inputMode="url"
          placeholder="https://..."
        />
      </div>
      <div className="field full">
        <label className="check" style={{ fontFamily: "var(--body)", fontSize: 16, color: "var(--ink)" }}>
          <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
          Shown on the list
        </label>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  draft,
  sections,
  onChange,
  onCancel,
  onSave,
  onDelete,
  hasNote,
}: {
  item: Item;
  draft: ItemDraft;
  sections: string[];
  onChange: (draft: ItemDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  hasNote: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <form
      className="item-editor"
      aria-label={`Edit ${item.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <ItemFieldsForm draft={draft} sections={sections} onChange={onChange} />
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-accent">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} style={{ marginLeft: "auto" }}>
          Delete
        </button>
      </div>
      {confirmDelete && (
        <div className="confirm" role="alertdialog" aria-label="Confirm delete">
          <p>
            Delete {item.name}?{hasNote ? " Its note will be deleted too." : ""} This can&apos;t be undone.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-danger" onClick={onDelete} autoFocus>
              Yes, delete
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function AddItemForm({ data, onCreate }: { data: ListData; onCreate: (draft: ItemDraft) => Promise<boolean> }) {
  const empty: ItemDraft = {
    name: "",
    store: "Amazon Fresh",
    section: "",
    size: "",
    price: "",
    imageUrl: "",
    sort: "",
    active: true,
  };
  const [draft, setDraft] = useState<ItemDraft>(empty);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = draft;
    // Keep the store and section, so several items in one section are quick to add.
    setDraft({ ...empty, store: sent.store, section: sent.section });
    const ok = await onCreate(sent);
    if (!ok) setDraft(sent);
  };

  return (
    <form className="card card-pad" onSubmit={submit} aria-label="Add item">
      <ItemFieldsForm draft={draft} sections={sectionNames(data, draft.store)} onChange={setDraft} />
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-accent" disabled={!draft.name.trim() || !draft.section.trim()}>
          Add item
        </button>
      </div>
    </form>
  );
}

// ---- Import

const FIELD_LABEL: Partial<Record<keyof Item, string>> = {
  imageUrl: "photo",
  active: "shown",
};

// Sort-only changes are usually just renumbering from a pasted order; they're counted, not listed.
function describeChange(c: ImportPlan["changed"][number]): string {
  const parts = c.fields.filter((f) => f !== "sort").map((f) => {
    const label = FIELD_LABEL[f] ?? f;
    if (f === "imageUrl") return "new photo";
    const before = c.before[f] ?? "none";
    const after = c.after[f] ?? "none";
    return `${label}: ${String(before)} → ${String(after)}`;
  });
  return `${c.after.store} · ${c.before.name}: ${parts.join("; ")}`;
}

function ImportPanel({
  track,
  onReplaced,
  copyJson,
  jsonFallback,
}: {
  track: ReturnType<typeof useList>["track"];
  onReplaced: () => void;
  copyJson: () => void;
  jsonFallback: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ plan: ImportPlan; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const runPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setPreview(null);
    const res = await api<{ plan: ImportPlan }>("POST", "/api/import", { text, mode: "preview" });
    setBusy(false);
    if (res.ok) setPreview({ plan: res.data.plan, text });
    else setErrors(errorsFrom(res));
  };

  const replace = async () => {
    if (!preview) return;
    setBusy(true);
    const res = await track(() =>
      api<{ plan: ImportPlan }>("POST", "/api/import", { text: preview.text, mode: "apply", basis: preview.plan.basis }),
    );
    setBusy(false);
    if (res.ok) {
      setPreview(null);
      setText("");
      onReplaced();
    } else {
      setPreview(null);
      setErrors(errorsFrom(res));
    }
  };

  const plan = preview?.plan;
  const changeCount = plan ? plan.added.length + plan.changed.length + plan.removed.length : 0;
  const changed = plan ? plan.changed.filter((c) => c.fields.some((f) => f !== "sort")) : [];
  const renumbered = plan ? plan.changed.length - changed.length : 0;

  return (
    <section className="card card-pad stack" aria-label="Import list">
      <p>
        Paste a JSON list to replace the items. Items are matched by <code>id</code>, or else by store and name, and
        keep their photo, price and note. Anything not in the pasted list is removed.
      </p>
      <details open>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
          Format and example
        </summary>
        <p className="row-sub">
          Required: <code>store</code> (&quot;Amazon Fresh&quot; or &quot;Netcost&quot;), <code>section</code>,{" "}
          <code>name</code>. Optional: <code>id</code>, <code>size</code>, <code>price</code>, <code>imageUrl</code>,{" "}
          <code>sort</code>,{" "}
          <code>active</code>. Without <code>sort</code>, items keep the pasted order.
        </p>
        <pre className="code">{IMPORT_EXAMPLE}</pre>
      </details>

      <form onSubmit={runPreview}>
        <label htmlFor={id} className="sr-only">
          Pasted list (JSON)
        </label>
        <textarea
          id={id}
          className="textarea"
          style={{ fontFamily: "var(--mono)", minHeight: 160 }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setErrors([]);
          }}
          placeholder="Paste the list here"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="submit" className="btn" disabled={!text.trim() || busy}>
            Preview
          </button>
          <button type="button" className="btn btn-quiet" onClick={copyJson}>
            Copy current list as JSON
          </button>
        </div>
        {jsonFallback}
      </form>

      {errors.length > 0 && (
        <div role="alert">
          <p className="error-text" style={{ fontWeight: 700 }}>
            {errors.length === 1 ? "Fix this, then preview again:" : `Fix these ${errors.length} problems, then preview again:`}
          </p>
          <ul className="error-list error-text">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <div aria-live="polite">
          <p style={{ fontWeight: 700 }}>
            {plan.added.length} added, {changed.length} changed, {plan.removed.length} removed
            {renumbered > 0 ? `, ${renumbered} reordered` : ""}, {plan.unchanged} unchanged.
          </p>
          <div style={{ marginTop: 12 }}>
            {plan.added.length > 0 && (
              <div className="preview-group">
                <h4>Added</h4>
                <ul>
                  {plan.added.map((i) => (
                    <li key={i.id}>
                      {i.store} · {i.section} · {itemLabel(i)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {changed.length > 0 && (
              <div className="preview-group">
                <h4>Changed</h4>
                <ul>
                  {changed.map((c) => (
                    <li key={c.before.id}>{describeChange(c)}</li>
                  ))}
                </ul>
              </div>
            )}
            {renumbered > 0 && (
              <div className="preview-group">
                <h4>Reordered</h4>
                <p>
                  {renumbered} {renumbered === 1 ? "item gets a new sort number" : "items get new sort numbers"} from
                  the pasted order.
                </p>
              </div>
            )}
            {plan.removed.length > 0 && (
              <div className="preview-group">
                <h4>Removed</h4>
                <ul>
                  {plan.removed.map(({ item, note }) => (
                    <li key={item.id}>
                      {item.store} · {itemLabel(item)}
                      {note ? ` (its note "${note}" will be deleted)` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-accent" onClick={replace} disabled={busy || changeCount === 0}>
              {changeCount === 0 ? "Nothing to change" : "Replace list"}
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function errorsFrom(res: { error: string; body?: unknown }): string[] {
  const body = res.body as { errors?: unknown } | undefined;
  if (body && Array.isArray(body.errors) && body.errors.length > 0) return body.errors.map(String);
  return [res.error || "Couldn't reach the server. Try again."];
}

// ---- Rounds

function NewRound({ data, onConfirm }: { data: ListData; onConfirm: () => Promise<boolean | undefined> }) {
  const [confirming, setConfirming] = useState(false);
  const notes = Object.keys(data.notes).length;
  const adds = data.adds.length;

  return (
    <section className="card card-pad" aria-label="Start a new round">
      <p>
        Saves the current notes and adds under Past rounds with today&apos;s date, then clears them and sets the list
        back to draft. Items stay.
      </p>
      {!confirming ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Start a new round
          </button>
        </div>
      ) : (
        <div className="confirm" role="alertdialog" aria-label="Confirm new round">
          <p>
            Save {notes} {notes === 1 ? "note" : "notes"} and {adds} {adds === 1 ? "add" : "adds"} to Past rounds and
            clear them?
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-accent"
              autoFocus
              onClick={async () => {
                setConfirming(false);
                await onConfirm();
              }}
            >
              Yes, start new round
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PastRounds({ rounds, error, onRetry }: { rounds: Round[] | null; error: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <div className="card state" role="alert">
        <p>Couldn&apos;t load past rounds.</p>
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (!rounds) return <div className="card state">Loading past rounds...</div>;
  if (rounds.length === 0) {
    return (
      <div className="card empty">
        <p>No past rounds yet.</p>
      </div>
    );
  }
  return (
    <section className="card" aria-label="Past rounds">
      {rounds.map((r) => (
        <article className="round" key={r.id}>
          <h3>{formatDate(r.date)}</h3>
          {r.notes.length > 0 && (
            <>
              <p className="mono muted">Notes</p>
              <ul>
                {r.notes.map((n, i) => (
                  <li key={i}>
                    {n.store} · {n.item}: {n.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.adds.length > 0 && (
            <>
              <p className="mono muted" style={{ marginTop: 8 }}>
                Adds
              </p>
              <ul>
                {r.adds.map((a, i) => (
                  <li key={i}>
                    {a.store === "Either" ? "Either store" : a.store} · {a.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
