import type { NeonStageApi } from './ipc';

declare global {
  interface Window {
    neonstage: NeonStageApi;
  }
}

export {};
