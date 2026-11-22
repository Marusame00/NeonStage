import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BroadcastSafeStatus, ChatOp, ChatSnapshot } from '../../shared/chat';
import type { ProjectDoc } from '../../shared/model';
import { buildOutputScene, type OutputScene, type OutputTarget } from '../../shared/output';
import { encodeSse, SSE_RETRY_MS, type ServerMessage } from '../../shared/protocol';
import type { RuntimeState } from '../../shared/runtime';
import { getWidget } from '../../widgets/registry';

export interface HubSource {
  getLiveDoc(): ProjectDoc;
  getProgramSceneId(): string;
  getRuntime(): RuntimeState;
  getChat(): ChatSnapshot;
  getBroadcastStatus(): BroadcastSafeStatus;
  now(): number;
}

const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_CLIENTS = 64;
const PING_MS = 15_000;

interface Client {
  res: ServerResponse;
  target: OutputTarget;
  targetKey: string;
  sceneJson: string;
  sourceKeys: Set<string>;
}

function sceneSourceKeys(scene: OutputScene | null): Set<string> {
  const keys = new Set<string>();
  if (!scene) return keys;
  for (const node of scene.nodes) {
    if (!node.widget) continue;
    const definition = getWidget(node.widget.kind);
    if (!definition?.dataSources) continue;
    const props = definition.validate(node.widget.props);
    for (const request of definition.dataSources(props)) keys.add(request.key);
  }
  return keys;
}

function filterChat(chat: ChatSnapshot, keys: Set<string>): ChatSnapshot {
  const out: ChatSnapshot = {};
  for (const key of keys) {
    const list = chat[key];
    if (list) out[key] = list;
  }
  return out;
}

export class SseHub {
  private readonly clients = new Set<Client>();
  private readonly pingTimer: NodeJS.Timeout;
  private rev = 0;

  constructor(private readonly source: HubSource) {
    this.pingTimer = setInterval(() => this.ping(), PING_MS);
    this.pingTimer.unref();
  }

  attach(_req: IncomingMessage, res: ServerResponse, target: OutputTarget): void {
    if (this.clients.size >= MAX_CLIENTS) {
      res.writeHead(503, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      res.end('Too many output connections');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);

    const scene = buildOutputScene(
      this.source.getLiveDoc(),
      this.source.getProgramSceneId(),
      target,
    );
    const sourceKeys = sceneSourceKeys(scene);
    const client: Client = {
      res,
      target,
      targetKey: JSON.stringify(target),
      sceneJson: JSON.stringify(scene),
      sourceKeys,
    };
    this.clients.add(client);
    res.on('close', () => {
      this.clients.delete(client);
    });

    this.send(client, {
      t: 'snapshot',
      serverNow: this.source.now(),
      rev: this.rev,
      target,
      scene,
      runtime: this.source.getRuntime(),
      chat: filterChat(this.source.getChat(), sourceKeys),
      providers: this.source.getBroadcastStatus(),
    });
  }

  docChanged(): void {
    this.rev += 1;
    const doc = this.source.getLiveDoc();
    const programSceneId = this.source.getProgramSceneId();
    const cache = new Map<string, { json: string; scene: OutputScene | null }>();

    for (const client of this.clients) {
      let entry = cache.get(client.targetKey);
      if (!entry) {
        const scene = buildOutputScene(doc, programSceneId, client.target);
        entry = { json: JSON.stringify(scene), scene };
        cache.set(client.targetKey, entry);
      }
      if (entry.json === client.sceneJson) continue;
      client.sceneJson = entry.json;
      client.sourceKeys = sceneSourceKeys(entry.scene);
      this.send(client, { t: 'scene', rev: this.rev, scene: entry.scene });
    }
  }

  runtimeChanged(): void {
    const message: ServerMessage = {
      t: 'runtime',
      runtime: this.source.getRuntime(),
      serverNow: this.source.now(),
    };
    for (const client of this.clients) this.send(client, message);
  }

  chatOps(ops: ChatOp[]): void {
    if (ops.length === 0) return;
    for (const client of this.clients) {
      const filtered = ops.filter((op) => client.sourceKeys.has(op.sourceKey));
      if (filtered.length === 0) continue;
      this.send(client, { t: 'chat', ops: filtered });
    }
  }

  providersChanged(): void {
    const message: ServerMessage = { t: 'providers', providers: this.source.getBroadcastStatus() };
    for (const client of this.clients) this.send(client, message);
  }

  clientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        client.res.destroy();
      }
    }
    this.clients.clear();
  }

  dispose(): void {
    clearInterval(this.pingTimer);
    this.closeAll();
  }

  private ping(): void {
    const message: ServerMessage = { t: 'ping', serverNow: this.source.now() };
    for (const client of this.clients) this.send(client, message);
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.res.writableEnded || client.res.destroyed) {
      this.clients.delete(client);
      return;
    }
    const ok = client.res.write(encodeSse(message));
    if (!ok && client.res.writableLength > MAX_BUFFERED_BYTES) {
      this.clients.delete(client);
      client.res.destroy();
    }
  }
}
