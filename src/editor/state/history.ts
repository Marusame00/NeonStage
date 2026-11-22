import type { ProjectDoc } from '../../shared/model';

export interface HistoryEntry {
  doc: ProjectDoc;
  key: string | null;
  at: number;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: ProjectDoc[];
  lastKey: string | null;
  lastAt: number;
}

export interface TransientState {
  base: ProjectDoc;
  current: ProjectDoc;
}

export const HISTORY_LIMIT = 150;
export const COALESCE_MS = 800;

export function createHistory(): HistoryState {
  return { past: [], future: [], lastKey: null, lastAt: 0 };
}

function push(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [...past, entry];
  if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
  return next;
}

export function commit(
  history: HistoryState,
  current: ProjectDoc,
  next: ProjectDoc,
  coalesceKey: string | null,
  now: number,
): HistoryState {
  if (next === current) return history;
  const merge =
    coalesceKey !== null &&
    history.lastKey === coalesceKey &&
    history.past.length > 0 &&
    now - history.lastAt <= COALESCE_MS;
  if (merge) return { ...history, lastAt: now };
  return {
    past: push(history.past, { doc: current, key: coalesceKey, at: now }),
    future: [],
    lastKey: coalesceKey,
    lastAt: now,
  };
}

export function undo(
  history: HistoryState,
  current: ProjectDoc,
): { history: HistoryState; doc: ProjectDoc } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
      lastKey: null,
      lastAt: 0,
    },
    doc: entry.doc,
  };
}

export function redo(
  history: HistoryState,
  current: ProjectDoc,
  now: number,
): { history: HistoryState; doc: ProjectDoc } | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    history: {
      past: push(history.past, { doc: current, key: null, at: now }),
      future: history.future.slice(1),
      lastKey: null,
      lastAt: now,
    },
    doc: next,
  };
}

export function beginTransient(doc: ProjectDoc): TransientState {
  return { base: doc, current: doc };
}

export function transient(state: TransientState, next: ProjectDoc): TransientState {
  return state.current === next ? state : { ...state, current: next };
}

export function endTransient(
  state: TransientState,
  history: HistoryState,
  now: number,
): { history: HistoryState; changed: boolean } {
  if (state.current === state.base) return { history, changed: false };
  return {
    history: {
      past: push(history.past, { doc: state.base, key: null, at: now }),
      future: [],
      lastKey: null,
      lastAt: now,
    },
    changed: true,
  };
}
