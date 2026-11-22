import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayServer } from '../src/main/server/httpServer';
import { SseHub, type HubSource } from '../src/main/server/sseHub';
import type { ChatMessage, ChatSnapshot } from '../src/shared/chat';
import { createEmptyProject, createScene, type ProjectDoc } from '../src/shared/model';
import { addNode, createWidgetNode } from '../src/shared/ops';
import type { ServerMessage } from '../src/shared/protocol';
import type { RuntimeState } from '../src/shared/runtime';
import { parseProjectDoc } from '../src/shared/schema';

const dirs: string[] = [];
const clients: SseClient[] = [];
let server: OverlayServer | null = null;
let hub: SseHub | null = null;

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  if (server) {
    await server.stop();
    server = null;
  }
  hub = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeOverlayDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-overlay-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'static', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>overlay</body></html>');
  fs.writeFileSync(path.join(dir, 'static', 'assets', 'a.js'), 'console.log("a");');
  return dir;
}

function buildDoc(): ProjectDoc {
  const base = createEmptyProject('Server test');
  let first = base.scenes[0]!;
  first = addNode(first, createWidgetNode('text', 0, 0, { props: { text: 'hello' } }));
  first = addNode(first, createWidgetNode('chat-twitch', 0, 200, { props: { source: 'demo' } }));
  let second = createScene('Text only', 1920, 1080);
  second = addNode(second, createWidgetNode('text', 0, 0, { props: { text: 'only' } }));
  return parseProjectDoc({ ...base, scenes: [first, second] });
}

function setText(doc: ProjectDoc, text: string): ProjectDoc {
  const scenes = doc.scenes.map((scene) => {
    const nodes = { ...scene.nodes };
    for (const [id, node] of Object.entries(nodes)) {
      if (node.widget?.kind !== 'text') continue;
      nodes[id] = { ...node, widget: { ...node.widget, props: { ...node.widget.props, text } } };
    }
    return { ...scene, nodes };
  });
  return { ...doc, scenes };
}

const sampleMessage: ChatMessage = {
  id: 'm1',
  sourceKey: 'demo:twitch',
  platform: 'twitch',
  demo: true,
  ts: 1,
  author: { id: 'demo-viewer', name: 'DemoViewer', badges: [] },
  segments: [{ t: 'text', text: 'hello chat' }],
  kind: 'message',
  meta: {},
};

class FakeSource implements HubSource {
  doc: ProjectDoc;
  runtime: RuntimeState = {
    timers: { 'tm-1': { running: true, startedAt: 1000, accumulatedMs: 0 } },
    goals: {},
    session: { startedAt: null },
  };
  chat: ChatSnapshot = { 'demo:twitch': [sampleMessage] };

  constructor(doc: ProjectDoc) {
    this.doc = doc;
  }

  getLiveDoc(): ProjectDoc {
    return this.doc;
  }

  getProgramSceneId(): string {
    return this.doc.scenes[0]!.id;
  }

  getRuntime(): RuntimeState {
    return this.runtime;
  }

  getChat(): ChatSnapshot {
    return this.chat;
  }

  getBroadcastStatus(): Record<string, 'demo'> {
    return { 'demo:twitch': 'demo' };
  }

  now(): number {
    return 5000;
  }
}

class SseClient {
  messages: ServerMessage[] = [];
  private buffer = '';
  private readonly req: http.ClientRequest;
  private res: http.IncomingMessage | null = null;

  constructor(port: number, pathname: string) {
    this.req = http.get(
      { host: '127.0.0.1', port, path: pathname },
      (res) => {
        this.res = res;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => this.onData(chunk));
      },
    );
    this.req.on('error', () => undefined);
  }

  async waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 4000,
  ): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for an SSE message');
  }

  close(): void {
    this.res?.destroy();
    this.req.destroy();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n\n');
    while (index >= 0) {
      const frame = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          this.messages.push(JSON.parse(line.slice(6)) as ServerMessage);
        } catch {
          continue;
        }
      }
      index = this.buffer.indexOf('\n\n');
    }
  }
}

function request(
  port: number,
  pathname: string,
  options: { method?: string; host?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: options.method ?? 'GET',
        headers: options.host ? { Host: options.host } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function startServer(source: HubSource): Promise<{ port: number; hub: SseHub }> {
  hub = new SseHub(source);
  server = new OverlayServer({
    overlayDir: makeOverlayDir(),
    hub,
    assets: { resolve: () => null },
    appName: 'NeonStage',
    version: '1.0.0',
  });
  const status = await server.start(0);
  expect(status.state).toBe('running');
  return { port: status.port, hub };
}

describe('OverlayServer + SseHub', () => {
  it(
    'sends a snapshot first, then scene updates, and re-syncs on reconnect',
    { timeout: 15000 },
    async () => {
      const source = new FakeSource(buildDoc());
      const started = await startServer(source);

      const client = new SseClient(started.port, '/events/live');
      clients.push(client);
      const snapshot = await client.waitFor((message) => message.t === 'snapshot');
      expect(snapshot.t).toBe('snapshot');
      if (snapshot.t !== 'snapshot') throw new Error('unreachable');
      expect(snapshot.scene?.sceneId).toBe(source.doc.scenes[0]!.id);
      expect(snapshot.scene?.nodes.length).toBeGreaterThan(0);

      source.doc = setText(source.doc, 'changed-value');
      started.hub.docChanged();
      const scene = await client.waitFor((message) => message.t === 'scene');
      expect(JSON.stringify(scene)).toContain('changed-value');

      client.close();
      source.doc = setText(source.doc, 'latest-value');
      started.hub.docChanged();

      const again = new SseClient(started.port, '/events/live');
      clients.push(again);
      const resynced = await again.waitFor((message) => message.t === 'snapshot');
      expect(JSON.stringify(resynced)).toContain('latest-value');
    },
  );

  it(
    'shares one runtime timer across connections',
    { timeout: 15000 },
    async () => {
      const source = new FakeSource(buildDoc());
      const started = await startServer(source);

      const three = [0, 1, 2].map(() => {
        const client = new SseClient(started.port, '/events/live');
        clients.push(client);
        return client;
      });
      const snapshots = await Promise.all(
        three.map((client) => client.waitFor((message) => message.t === 'snapshot')),
      );
      for (const snapshot of snapshots) {
        if (snapshot.t !== 'snapshot') throw new Error('unreachable');
        expect(snapshot.runtime.timers['tm-1']!.startedAt).toBe(1000);
        expect(Object.keys(snapshot.runtime.timers)).toHaveLength(1);
      }
    },
  );

  it(
    'delivers chat ops only to clients whose scene uses the source key',
    { timeout: 15000 },
    async () => {
      const source = new FakeSource(buildDoc());
      const started = await startServer(source);

      const live = new SseClient(started.port, '/events/live');
      const other = new SseClient(started.port, `/events/scene/${source.doc.scenes[1]!.id}`);
      clients.push(live, other);
      await live.waitFor((message) => message.t === 'snapshot');
      await other.waitFor((message) => message.t === 'snapshot');

      started.hub.chatOps([{ t: 'add', sourceKey: 'demo:twitch', message: sampleMessage }]);
      const chat = await live.waitFor((message) => message.t === 'chat');
      if (chat.t !== 'chat') throw new Error('unreachable');
      expect(chat.ops).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(other.messages.some((message) => message.t === 'chat')).toBe(false);
    },
  );

  it(
    'rejects bad hosts, methods and paths',
    { timeout: 15000 },
    async () => {
      const source = new FakeSource(buildDoc());
      const started = await startServer(source);

      const forbidden = await request(started.port, '/health', {
        host: `evil.com:${started.port}`,
      });
      expect(forbidden.status).toBe(403);

      const post = await request(started.port, '/health', { method: 'POST' });
      expect(post.status).toBe(405);

      const traversal = await request(started.port, '/static/../index.html');
      expect([400, 404]).toContain(traversal.status);

      const encoded = await request(started.port, '/static/%2e%2e/index.html');
      expect([400, 404]).toContain(encoded.status);

      const outputTraversal = await request(started.port, '/output/scene/..%2Fx');
      expect(outputTraversal.status).toBe(404);

      const media = await request(started.port, '/media/notanid');
      expect(media.status).toBe(404);

      const output = await request(started.port, '/output/live');
      expect(output.status).toBe(200);
      expect(output.headers['content-security-policy']).toContain("default-src 'none'");
      expect(output.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it(
    'reports an error when the port is already in use',
    { timeout: 15000 },
    async () => {
      const blocker = net.createServer();
      await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
      const address = blocker.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      const blockedHub = new SseHub(new FakeSource(buildDoc()));
      const blockedServer = new OverlayServer({
        overlayDir: makeOverlayDir(),
        hub: blockedHub,
        assets: { resolve: () => null },
        appName: 'NeonStage',
        version: '1.0.0',
      });
      const status = await blockedServer.start(port);

      expect(status.state).toBe('error');
      expect(status.port).toBe(port);
      expect(status.baseUrl).toBeNull();
      expect(status.message).toContain('already in use');

      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    },
  );
});
