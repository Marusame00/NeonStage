import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ChatMessage, SourceState } from '../shared/chat';
import type { RuntimeState } from '../shared/runtime';
import type { RenderStores } from './stores';

export type RenderMode = 'editor' | 'output';

export interface RenderContextValue {
  mode: RenderMode;
  stores: RenderStores;
  mediaUrl(assetId: string): string;
  reduceMotion: boolean;
}

const RenderContext = createContext<RenderContextValue | null>(null);

export interface RenderProviderProps {
  mode: RenderMode;
  stores: RenderStores;
  mediaUrl(assetId: string): string;
  reduceMotion?: boolean;
  children: ReactNode;
}

export function RenderProvider({
  mode,
  stores,
  mediaUrl,
  reduceMotion = false,
  children,
}: RenderProviderProps): ReactNode {
  const value = useMemo<RenderContextValue>(
    () => ({ mode, stores, mediaUrl, reduceMotion }),
    [mode, stores, mediaUrl, reduceMotion],
  );
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}

export function useRenderContext(): RenderContextValue {
  const value = useContext(RenderContext);
  if (!value) throw new Error('useRenderContext must be used inside a RenderProvider');
  return value;
}

export function useRuntime(): RuntimeState {
  const { stores } = useRenderContext();
  return useSyncExternalStore(
    stores.runtime.subscribe,
    stores.runtime.getRuntime,
    stores.runtime.getRuntime,
  );
}

export function useServerNow(intervalMs: number): number {
  const { stores } = useRenderContext();
  const [now, setNow] = useState(() => stores.runtime.serverNow());

  useEffect(() => {
    setNow(stores.runtime.serverNow());
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(stores.runtime.serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [stores, intervalMs]);

  return now;
}

function splitKeys(key: string): string[] {
  return key.length === 0 ? [] : key.split('\u0000');
}

function mergeMessages(sources: ChatMessage[][]): ChatMessage[] {
  if (sources.length === 0) return [];
  if (sources.length === 1) return sources[0]!;
  const merged = sources.flat();
  merged.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return merged;
}

export function useChatSources(keys: string[]): ChatMessage[] {
  const { stores } = useRenderContext();
  const chat = stores.chat;
  const key = keys.join('\u0000');
  const cache = useRef<{ key: string; sources: ChatMessage[][]; merged: ChatMessage[] } | null>(null);

  const getSnapshot = useCallback((): ChatMessage[] => {
    const sources = splitKeys(key).map((entry) => chat.getSource(entry));
    const current = cache.current;
    if (
      current &&
      current.key === key &&
      current.sources.length === sources.length &&
      current.sources.every((source, index) => source === sources[index])
    ) {
      return current.merged;
    }
    const merged = mergeMessages(sources);
    cache.current = { key, sources, merged };
    return merged;
  }, [chat, key]);

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const unsubs = splitKeys(key).map((entry) => chat.subscribe(entry, listener));
      return () => {
        for (const unsubscribe of unsubs) unsubscribe();
      };
    },
    [chat, key],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export type SourceStatusMap = Record<string, SourceState | undefined>;

export function useSourceStatus(keys: string[]): SourceStatusMap {
  const { stores } = useRenderContext();
  const status = stores.status;
  const key = keys.join('\u0000');
  const cache = useRef<{ key: string; values: (SourceState | undefined)[]; map: SourceStatusMap } | null>(
    null,
  );

  const getSnapshot = useCallback((): SourceStatusMap => {
    const values = splitKeys(key).map((entry) => status.get(entry));
    const current = cache.current;
    if (
      current &&
      current.key === key &&
      current.values.length === values.length &&
      current.values.every((value, index) => value === values[index])
    ) {
      return current.map;
    }
    const map: SourceStatusMap = {};
    splitKeys(key).forEach((entry, index) => {
      map[entry] = values[index];
    });
    cache.current = { key, values, map };
    return map;
  }, [status, key]);

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const unsubs = splitKeys(key).map((entry) => status.subscribe(entry, listener));
      return () => {
        for (const unsubscribe of unsubs) unsubscribe();
      };
    },
    [status, key],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
