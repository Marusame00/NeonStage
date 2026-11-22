import type { Logger } from '../log';
import type { SecretStore } from '../store/secrets';

export interface ProviderTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

export const systemTimers: ProviderTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  now: () => Date.now(),
};

export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export const defaultWsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

export type FetchLike = typeof fetch;

export interface AdapterDeps {
  secrets: SecretStore;
  log: Logger;
  openExternal(url: string): Promise<void>;
  onStatusChange?: () => void;
  fetch?: FetchLike;
  timers?: ProviderTimers;
}
