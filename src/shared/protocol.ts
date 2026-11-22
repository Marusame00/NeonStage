import type { BroadcastSafeStatus, ChatOp, ChatSnapshot } from './chat';
import type { OutputScene, OutputTarget } from './output';
import type { RuntimeState } from './runtime';

export type ServerMessage =
  | {
      t: 'snapshot';
      serverNow: number;
      rev: number;
      target: OutputTarget;
      scene: OutputScene | null;
      runtime: RuntimeState;
      chat: ChatSnapshot;
      providers: BroadcastSafeStatus;
    }
  | { t: 'scene'; rev: number; scene: OutputScene | null }
  | { t: 'runtime'; runtime: RuntimeState; serverNow: number }
  | { t: 'chat'; ops: ChatOp[] }
  | { t: 'providers'; providers: BroadcastSafeStatus }
  | { t: 'ping'; serverNow: number };

export const SSE_RETRY_MS = 2000;

export function encodeSse(message: ServerMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}
