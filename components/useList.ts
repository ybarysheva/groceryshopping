"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListData } from "@/lib/types";

export type SaveState = "idle" | "saving" | "saved";
export type Toast = { id: number; kind: "error" | "info"; text: string } | null;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; body?: unknown };

export async function api<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = data && typeof data.error === "string" ? data.error : "";
      return { ok: false, error, status: res.status, body: data };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "", status: 0 };
  }
}

/** crypto.randomUUID needs a secure context; fall back for plain-http LAN testing. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const REFRESH_MS = 30_000;

/**
 * Loads the list, keeps it fresh (focus, visibility, every 30s while visible), and runs
 * optimistic writes: apply locally, call the API, undo and toast on failure.
 */
export function useList() {
  const [data, setData] = useState<ListData | null>(null);
  // null = no error; otherwise the message to show (the server's, when it sent one).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [toast, setToast] = useState<Toast>(null);

  const hasData = useRef(false);
  const pending = useRef(0);
  const writeSeq = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((kind: "error" | "info", text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  const load = useCallback(async () => {
    const seq = writeSeq.current;
    const res = await api<ListData>("GET", "/api/list");
    // A write started while this was in flight: its optimistic state wins until the next refresh.
    if (pending.current > 0 || seq !== writeSeq.current) return;
    if (res.ok) {
      hasData.current = true;
      setData(res.data);
      setLoadError(null);
    } else if (!hasData.current) {
      setLoadError(res.error || "Couldn't load the list. Check your connection and try again.");
    }
  }, []);

  const retry = useCallback(() => {
    setLoadError(null);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const mutate = useCallback(
    async <T>(opts: {
      apply: (d: ListData) => ListData;
      undo: (d: ListData) => ListData;
      request: () => Promise<ApiResult<T>>;
      onSuccess?: (result: T) => void;
    }): Promise<boolean> => {
      writeSeq.current++;
      pending.current++;
      clearTimeout(savedTimer.current);
      setSaveState("saving");
      setData((d) => (d ? opts.apply(d) : d));

      const res = await opts.request();
      pending.current--;

      if (res.ok) {
        opts.onSuccess?.(res.data);
      } else {
        setData((d) => (d ? opts.undo(d) : d));
        showToast("error", res.error ? `Didn't save. ${res.error}` : "Didn't save. Try again.");
      }

      if (pending.current === 0) {
        setSaveState(res.ok ? "saved" : "idle");
        savedTimer.current = setTimeout(() => setSaveState("idle"), 2500);
        // Pick up anything the other person changed meanwhile.
        void load();
      }
      return res.ok;
    },
    [load, showToast],
  );

  /** For writes that aren't optimistic (import, rounds): shows Saving/Saved and reloads. */
  const track = useCallback(
    async <T>(request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      writeSeq.current++;
      pending.current++;
      clearTimeout(savedTimer.current);
      setSaveState("saving");
      const res = await request();
      pending.current--;
      if (pending.current === 0) {
        setSaveState(res.ok ? "saved" : "idle");
        savedTimer.current = setTimeout(() => setSaveState("idle"), 2500);
        void load();
      }
      return res;
    },
    [load],
  );

  return { data, setData, loadError, retry, saveState, toast, setToast, showToast, mutate, track, reload: load };
}
