import { app, BrowserWindow, safeStorage, type NativeImage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { ProviderStatus } from '../shared/chat';
import { expandRect, unionRects, type Rect } from '../shared/geometry';
import { createEmptyProject, type ProjectDoc } from '../shared/model';
import { addNode, createWidgetNode, groupNodes } from '../shared/ops';
import { outputPaths, visualOverflow } from '../shared/output';
import type { ServerMessage } from '../shared/protocol';
import { timerElapsedMs } from '../shared/runtime';
import { parseProjectDoc } from '../shared/schema';
import type { DataSourceRequest } from '../widgets/contract';
import type { Logger } from './log';
import { createLogger } from './log';
import { resolvePaths, type AppPaths } from './paths';
import { DemoChatAdapter } from './providers/demo';
import { ProviderManager, type ChatAdapter, type ChatSink } from './providers/manager';
import { AppState } from './runtime/appState';
import { WidgetRuntimeHost } from './runtime/widgetRuntimeHost';
import { OverlayServer } from './server/httpServer';
import { SseHub } from './server/sseHub';
import { AssetStore } from './store/assets';
import { buildExport, ProjectStore } from './store/projectStore';
import { SecretStore } from './store/secrets';

export interface SelfTestOptions {
  appName: string;
  version: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  reason?: string;
}

interface NodeIds {
  text: string;
  frame: string;
  chatDemo: string;
  timer: string;
  group: string;
  childA: string;
  childB: string;
}

const CHECK_TIMEOUT_MS = 30_000;
const DOM_TIMEOUT_MS = 3_000;
const RECONNECT_TIMEOUT_MS = 12_000;
const CHAT_KEY = 'twitch:testchannel';
const SECRETS = ['SECRET-TOKEN-123', 'SECRET-REFRESH-456', 'SECRET-CLIENT-789'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  read: () => Promise<T | null> | T | null,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
    }
    await delay(50);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function firstDifference(left: string, right: string): string {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] === right[index]) continue;
    const from = Math.max(0, index - 40);
    return `at ${index}: ${left.slice(from, index + 40)} != ${right.slice(from, index + 40)}`;
  }
  return `lengths ${left.length} vs ${right.length}`;
}

function withText(doc: ProjectDoc, text: string): ProjectDoc {
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

function viewportFor(rects: Rect[], padding: number): Rect {
  const bounds = unionRects(rects);
  if (!bounds) throw new Error('no bounds to measure');
  const expanded = expandRect(bounds, Math.max(0, padding));
  const left = Math.floor(expanded.x);
  const top = Math.floor(expanded.y);
  const right = Math.ceil(expanded.x + expanded.w);
  const bottom = Math.ceil(expanded.y + expanded.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function nodeRect(node: { x: number; y: number; w: number; h: number }, overflow: number): Rect {
  return expandRect({ x: node.x, y: node.y, w: node.w, h: node.h }, overflow);
}

function request(
  port: number,
  pathname: string,
  options: { method?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET' },
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

class SseClient {
  readonly messages: ServerMessage[] = [];
  private buffer = '';
  private readonly req: http.ClientRequest;
  private res: http.IncomingMessage | null = null;

  constructor(port: number, pathname: string) {
    this.req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      this.res = res;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => this.onData(chunk));
    });
    this.req.on('error', () => undefined);
  }

  waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<ServerMessage> {
    return waitFor(
      () => this.messages.find(predicate) ?? null,
      timeoutMs,
      'an SSE message',
    );
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

class SpyAdapter implements ChatAdapter {
  readonly starts: DataSourceRequest[] = [];
  readonly stops: string[] = [];

  start(req: DataSourceRequest, sink: ChatSink): void {
    this.starts.push(req);
    sink.sourceState(req.key, 'live');
  }

  stop(key: string): void {
    this.stops.push(key);
  }

  status(): ProviderStatus | null {
    return null;
  }

  dispose(): void {
    this.starts.length = 0;
    this.stops.length = 0;
  }
}

class SelfTestRun {
  private readonly tmp: string;
  private readonly lines: string[] = [];
  private readonly results: CheckResult[] = [];
  private readonly windows = new Set<BrowserWindow>();
  private readonly clients = new Set<SseClient>();
  private readonly spy = new SpyAdapter();
  private readonly loadFlag = `selftest-${Date.now()}`;
  private clock = Date.now();
  private port = 0;
  private paths!: AppPaths;
  private secrets!: SecretStore;
  private assets!: AssetStore;
  private store!: ProjectStore;
  private appState!: AppState;
  private providers!: ProviderManager;
  private runtimeHost!: WidgetRuntimeHost;
  private hub!: SseHub;
  private server!: OverlayServer;
  private outputWindow: BrowserWindow | null = null;
  private ids!: NodeIds;

  constructor(private readonly options: SelfTestOptions) {
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-selftest-'));
    app.setPath('userData', this.tmp);
  }

  async execute(): Promise<number> {
    const log = createLogger(path.join(this.tmp, 'logs'));
    try {
      await this.setup(log);
      await this.check('server binds 127.0.0.1 and /health responds', () => this.checkServer());
      await this.check('output page served from built assets with strict CSP', () =>
        this.checkOutputPage(),
      );
      await this.check('full-scene output is transparent', () => this.checkTransparency());
      await this.check('editor-only UI absent from output', () => this.checkEditorOnly());
      await this.check('live edit updates the open output without reload', () =>
        this.checkLiveUpdate(),
      );
      await this.check('preview/live separation holds until publish', () =>
        this.checkPreviewLive(),
      );
      await this.check('object and group output bounds match computed viewport', () =>
        this.checkBounds(),
      );
      await this.check('timer state is shared across connections', () => this.checkTimerSync());
      await this.check('chat sources are ref-counted across connections', () =>
        this.checkChatSharing(),
      );
      await this.check('first SSE message is a full snapshot', () => this.checkSnapshotFirst());
      await this.check('output reconnects after a server restart', () => this.checkReconnect());
      await this.check('project persists and recovers from backup', () => this.checkPersistence());
      await this.check('export excludes secrets and absolute paths', () => this.checkExport());
      await this.check('output server is read-only', () => this.checkReadOnly());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.results.push({ name: 'setup', ok: false, reason });
      this.emit(`FAIL setup: ${reason}`);
    } finally {
      await this.cleanup();
    }

    const failed = this.results.filter((result) => !result.ok);
    this.emit(
      `SUMMARY ${this.results.length - failed.length}/${this.results.length} checks passed`,
    );
    this.writeLog();
    const code = failed.length === 0 ? 0 : 1;
    this.removeTempDir();
    return code;
  }

  private async setup(log: Logger): Promise<void> {
    this.paths = resolvePaths();
    this.secrets = new SecretStore(this.paths.secretsFile, {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (buffer) => safeStorage.decryptString(buffer),
    });
    this.assets = new AssetStore(this.paths.assets);
    this.store = new ProjectStore(this.paths.projects);
    const created = this.store.create('Self test');
    this.appState = new AppState(created.file, {
      store: this.store,
      runtimeFile: this.paths.runtimeFile,
      now: () => this.clock,
    });

    this.providers = new ProviderManager();
    this.providers.registerAdapter('demo-twitch', new DemoChatAdapter('twitch'));
    this.providers.registerAdapter('demo-youtube', new DemoChatAdapter('youtube'));
    this.providers.registerAdapter('twitch', this.spy);
    this.runtimeHost = new WidgetRuntimeHost(this.providers);

    this.hub = new SseHub({
      getLiveDoc: () => this.appState.live,
      getProgramSceneId: () => this.appState.programSceneId,
      getRuntime: () => this.appState.runtime,
      getChat: () => this.appState.chat,
      getBroadcastStatus: () => this.providers.getBroadcastStatus(),
      now: () => this.clock,
    });

    this.server = new OverlayServer({
      overlayDir: this.paths.overlayDir,
      hub: this.hub,
      assets: this.assets,
      appName: this.options.appName,
      version: this.options.version,
    });

    this.appState.on('draft', () => {
      this.runtimeHost.sync([this.appState.draft, this.appState.live]);
    });
    this.appState.on('live', () => {
      this.runtimeHost.sync([this.appState.draft, this.appState.live]);
      this.hub.docChanged();
    });
    this.appState.on('runtime', () => {
      this.hub.runtimeChanged();
    });

    const requested = this.requestedPort();
    const status = await this.server.start(requested);
    if (status.state !== 'running') {
      throw new Error(status.message ?? `server did not start on port ${requested}`);
    }
    this.port = status.port;
    log.info(`selftest server on port ${this.port}`);

    this.appState.updateDraft(this.buildDoc());
    this.appState.setProgramScene(this.appState.draft.scenes[0]!.id);
    this.appState.publish();
  }

  private requestedPort(): number {
    const arg = process.argv.find((entry) => entry.startsWith('--selftest-port='));
    if (!arg) return 0;
    const value = Number(arg.slice('--selftest-port='.length).trim());
    return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : 0;
  }

  private buildDoc(): ProjectDoc {
    const base = createEmptyProject('Self test');
    let scene = base.scenes[0]!;
    const text = createWidgetNode('text', 120, 120, { props: { text: 'ALPHA-ONE' }, w: 700, h: 140 });
    scene = addNode(scene, text);
    const frame = createWidgetNode('frame', 120, 320, { w: 960, h: 540 });
    scene = addNode(scene, frame);
    const chatDemo = createWidgetNode('chat-twitch', 1200, 120, {
      props: { source: 'demo' },
      w: 420,
      h: 480,
    });
    scene = addNode(scene, chatDemo);
    const chatLiveA = createWidgetNode('chat-twitch', 1200, 640, {
      props: { source: 'live', channel: 'testchannel' },
      w: 420,
      h: 200,
    });
    scene = addNode(scene, chatLiveA);
    const chatLiveB = createWidgetNode('chat-twitch', 1200, 860, {
      props: { source: 'live', channel: 'testchannel' },
      w: 420,
      h: 200,
    });
    scene = addNode(scene, chatLiveB);
    const timer = createWidgetNode('timer', 120, 900, { props: { mode: 'elapsed' }, w: 420, h: 120 });
    scene = addNode(scene, timer);
    const childA = createWidgetNode('text', 300, 1000, { props: { text: 'GROUP-A' }, w: 200, h: 60 });
    const childB = createWidgetNode('text', 700, 1000, { props: { text: 'GROUP-B' }, w: 200, h: 60 });
    scene = addNode(scene, childA);
    scene = addNode(scene, childB);
    const grouped = groupNodes(scene, [childA.id, childB.id], 'Pair');
    scene = grouped.scene;

    this.ids = {
      text: text.id,
      frame: frame.id,
      chatDemo: chatDemo.id,
      timer: timer.id,
      group: grouped.groupId,
      childA: childA.id,
      childB: childB.id,
    };
    return parseProjectDoc({ ...base, scenes: [scene] });
  }

  private async check(name: string, fn: () => Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    const work = fn();
    work.catch(() => undefined);
    try {
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`check timed out after ${CHECK_TIMEOUT_MS} ms`)),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      this.results.push({ name, ok: true });
      this.emit(`PASS ${name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.results.push({ name, ok: false, reason });
      this.emit(`FAIL ${name}: ${reason}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkServer(): Promise<void> {
    const bound = this.server.boundAddress;
    if (!bound) throw new Error('the server reports no bound address');
    if (bound.address !== '127.0.0.1') throw new Error(`bound to ${bound.address}`);
    const health = await request(this.port, '/health');
    if (health.status !== 200) throw new Error(`/health returned ${health.status}`);
    const body = JSON.parse(health.body) as { ok?: boolean; app?: string; version?: string };
    if (body.ok !== true) throw new Error('/health did not report ok');
    if (body.app !== this.options.appName) throw new Error(`/health app is ${String(body.app)}`);
    if (body.version !== this.options.version) {
      throw new Error(`/health version is ${String(body.version)}`);
    }
  }

  private async checkOutputPage(): Promise<void> {
    const page = await request(this.port, '/output/live');
    if (page.status !== 200) throw new Error(`/output/live returned ${page.status}`);
    const csp = String(page.headers['content-security-policy'] ?? '');
    for (const part of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "base-uri 'none'",
      "img-src 'self' data:",
    ]) {
      if (!csp.includes(part)) throw new Error(`CSP is missing ${part}`);
    }
    if (csp.includes('frame-ancestors')) throw new Error('CSP still sets frame-ancestors');

    const scripts = page.body.match(/<script\b[^>]*>/gi) ?? [];
    for (const tag of scripts) {
      if (!/\bsrc=/.test(tag)) throw new Error('the output page contains an inline script');
    }

    const assets = [...page.body.matchAll(/(?:src|href)="(\/static\/[^"]+)"/g)].map(
      (match) => match[1]!,
    );
    if (assets.length === 0) throw new Error('the output page references no built assets');
    for (const asset of assets) {
      const res = await request(this.port, asset);
      if (res.status !== 200) throw new Error(`${asset} returned ${res.status}`);
      const type = String(res.headers['content-type'] ?? '');
      const ext = asset.slice(asset.lastIndexOf('.') + 1).toLowerCase();
      const expected = ext === 'js' ? 'text/javascript' : ext === 'css' ? 'text/css' : '';
      if (expected && !type.startsWith(expected)) {
        throw new Error(`${asset} has content-type ${type}`);
      }
    }
  }

  private async checkTransparency(): Promise<void> {
    const win = await this.openOutput('/output/live');
    this.outputWindow = win;
    await this.waitForText(win, 'ALPHA-ONE', DOM_TIMEOUT_MS);

    const image = await this.capture(win);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const alphaAt = (x: number, y: number): number => bitmap[(y * size.width + x) * 4 + 3] ?? 0;
    for (const [x, y] of [
      [0, 0],
      [size.width - 1, 0],
      [0, size.height - 1],
      [size.width - 1, size.height - 1],
    ]) {
      const alpha = alphaAt(x!, y!);
      if (alpha !== 0) throw new Error(`corner ${x},${y} has alpha ${alpha}`);
    }

    const backgrounds = (await win.webContents.executeJavaScript(
      `(() => {
        const root = document.getElementById('root');
        return [
          getComputedStyle(document.documentElement).backgroundColor,
          getComputedStyle(document.body).backgroundColor,
          root ? getComputedStyle(root).backgroundColor : 'missing',
        ];
      })()`,
    )) as unknown;
    if (!Array.isArray(backgrounds)) throw new Error('could not read computed backgrounds');
    for (const background of backgrounds) {
      if (background !== 'rgba(0, 0, 0, 0)') throw new Error(`background is ${String(background)}`);
    }

    let opaque = 0;
    for (let index = 3; index < bitmap.length; index += 4) {
      if ((bitmap[index] ?? 0) > 0) {
        opaque += 1;
        if (opaque > 100) break;
      }
    }
    if (opaque === 0) throw new Error('the capture has no non-transparent pixels');
  }

  private async checkEditorOnly(): Promise<void> {
    const win = this.requireOutputWindow();
    const text = await this.domText(win);
    for (const needle of ['GAME CAPTURE AREA', 'Editor only', 'DEMO DATA']) {
      if (text.includes(needle)) throw new Error(`output DOM contains "${needle}"`);
    }
    const stray = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('[class*="ns-editor"],[class*="selection"],[class*="checker"]').length`,
    )) as unknown;
    if (stray !== 0) throw new Error(`output DOM has ${String(stray)} editor-only elements`);
    const rows = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('.ns-chat-row').length`,
    )) as unknown;
    if (rows !== 0) throw new Error(`demo chat rendered ${String(rows)} rows in the output`);
  }

  private async checkLiveUpdate(): Promise<void> {
    const win = this.requireOutputWindow();
    const flag = await this.domFlag(win);
    this.appState.setLiveEdit(true);
    this.appState.updateDraft(withText(this.appState.draft, 'LIVE-EDIT-OK'));
    await this.waitForText(win, 'LIVE-EDIT-OK', DOM_TIMEOUT_MS);
    if ((await this.domFlag(win)) !== flag) throw new Error('the output page reloaded');
  }

  private async checkPreviewLive(): Promise<void> {
    const win = this.requireOutputWindow();
    this.appState.setLiveEdit(false);
    this.appState.updateDraft(withText(this.appState.draft, 'DRAFT-ONLY'));
    await delay(700);
    const text = await this.domText(win);
    if (text.includes('DRAFT-ONLY')) {
      throw new Error('a draft change reached the output with live edit off');
    }
    if (!text.includes('LIVE-EDIT-OK')) throw new Error('the output lost the live text');
    this.appState.publish();
    await this.waitForText(win, 'DRAFT-ONLY', DOM_TIMEOUT_MS);
  }

  private async checkBounds(): Promise<void> {
    const live = this.appState.live;
    const scene = live.scenes[0]!;
    const node = scene.nodes[this.ids.text]!;
    const expected = viewportFor([nodeRect(node, visualOverflow(node))], node.output.padding);

    const objectClient = this.openSse(
      outputPaths({ kind: 'object', sceneId: scene.id, nodeId: node.id }).eventsPath,
    );
    const objectSnapshot = await objectClient.waitFor((message) => message.t === 'snapshot');
    if (objectSnapshot.t !== 'snapshot' || !objectSnapshot.scene) {
      throw new Error('object output returned no scene');
    }
    const objectViewport = objectSnapshot.scene.viewport;
    if (canonical(objectViewport) !== canonical(expected)) {
      throw new Error(
        `object viewport ${canonical(objectViewport)} != expected ${canonical(expected)}`,
      );
    }
    const rendered = objectSnapshot.scene.nodes.find((entry) => entry.id === node.id);
    if (!rendered) throw new Error('object output does not contain the node');
    if (rendered.x !== node.x - expected.x || rendered.y !== node.y - expected.y) {
      throw new Error('object output did not offset the node into the viewport');
    }

    const group = scene.nodes[this.ids.group]!;
    const children = group.children.map((id) => scene.nodes[id]!);
    const groupExpected = viewportFor(
      children.map((child) => nodeRect(child, visualOverflow(child))),
      group.output.padding,
    );
    const groupClient = this.openSse(
      outputPaths({ kind: 'group', sceneId: scene.id, nodeId: group.id }).eventsPath,
    );
    const groupSnapshot = await groupClient.waitFor((message) => message.t === 'snapshot');
    if (groupSnapshot.t !== 'snapshot' || !groupSnapshot.scene) {
      throw new Error('group output returned no scene');
    }
    if (canonical(groupSnapshot.scene.viewport) !== canonical(groupExpected)) {
      throw new Error(
        `group viewport ${canonical(groupSnapshot.scene.viewport)} != expected ${canonical(groupExpected)}`,
      );
    }
    const first = groupSnapshot.scene.nodes.find((entry) => entry.id === this.ids.childA);
    const second = groupSnapshot.scene.nodes.find((entry) => entry.id === this.ids.childB);
    if (!first || !second) throw new Error('group output is missing a child');
    const originalA = scene.nodes[this.ids.childA]!;
    const originalB = scene.nodes[this.ids.childB]!;
    if (
      second.x - first.x !== originalB.x - originalA.x ||
      second.y - first.y !== originalB.y - originalA.y
    ) {
      throw new Error('group output changed the children relative positions');
    }
  }

  private async checkTimerSync(): Promise<void> {
    const timerId = this.ids.timer;
    this.appState.timerAction(timerId, 'start');
    const first = this.openSse('/events/live');
    const second = this.openSse('/events/live');
    const [snapshotA, snapshotB] = await Promise.all([
      first.waitFor((message) => message.t === 'snapshot'),
      second.waitFor((message) => message.t === 'snapshot'),
    ]);
    if (snapshotA.t !== 'snapshot' || snapshotB.t !== 'snapshot') {
      throw new Error('a connection did not receive a snapshot');
    }
    const timerA = snapshotA.runtime.timers[timerId];
    const timerB = snapshotB.runtime.timers[timerId];
    if (!timerA || !timerB) throw new Error('the timer is missing from a snapshot');
    if (canonical(timerA) !== canonical(timerB)) {
      throw new Error('timer state differs between connections');
    }
    if (snapshotA.serverNow !== snapshotB.serverNow) {
      throw new Error('server time differs between connections');
    }
    if (this.hub.clientCount() < 2) throw new Error('the hub reports fewer than two clients');

    const before = timerElapsedMs(timerA, snapshotA.serverNow);
    this.clock += 1200;
    const elapsed = timerElapsedMs(this.appState.runtime.timers[timerId], this.clock);
    if (elapsed !== before + 1200) {
      throw new Error(`timer advanced by ${elapsed - before} ms instead of 1200 ms`);
    }
  }

  private async checkChatSharing(): Promise<void> {
    if (this.providers.refCount(CHAT_KEY) !== 1) {
      throw new Error(`refCount is ${this.providers.refCount(CHAT_KEY)} before any connection`);
    }
    const twitchKeys = this.providers.activeKeys().filter((key) => key.startsWith('twitch:'));
    if (twitchKeys.length !== 1) {
      throw new Error(`activeKeys has ${twitchKeys.length} twitch entries`);
    }
    if (this.spy.starts.filter((req) => req.key === CHAT_KEY).length !== 1) {
      throw new Error('adapter.start was not called exactly once');
    }

    const connections = [0, 1, 2].map(() => this.openSse('/events/live'));
    await Promise.all(connections.map((client) => client.waitFor((m) => m.t === 'snapshot')));
    if (this.providers.refCount(CHAT_KEY) !== 1) {
      throw new Error(`refCount is ${this.providers.refCount(CHAT_KEY)} with three connections`);
    }
    if (this.spy.starts.filter((req) => req.key === CHAT_KEY).length !== 1) {
      throw new Error('adapter.start was called again for extra connections');
    }
    for (const client of connections) {
      client.close();
      this.clients.delete(client);
    }

    this.runtimeHost.sync([]);
    if (this.providers.refCount(CHAT_KEY) !== 0) {
      throw new Error(`refCount is ${this.providers.refCount(CHAT_KEY)} after release`);
    }
    if (this.spy.stops.filter((key) => key === CHAT_KEY).length !== 1) {
      throw new Error('adapter.stop was not called exactly once');
    }
    this.runtimeHost.sync([this.appState.draft, this.appState.live]);
  }

  private async checkSnapshotFirst(): Promise<void> {
    const client = this.openSse('/events/live');
    await waitFor(() => (client.messages.length > 0 ? true : null), 5000, 'the first SSE message');
    const first = client.messages[0]!;
    if (first.t !== 'snapshot') throw new Error(`the first message is ${first.t}`);
    if (!first.scene) throw new Error('the snapshot has no scene');
    if (!first.runtime || !first.chat) throw new Error('the snapshot has no runtime or chat');
  }

  private async checkReconnect(): Promise<void> {
    const win = this.requireOutputWindow();
    const flag = await this.domFlag(win);
    const port = this.port;
    await this.server.stop();
    this.appState.updateDraft(withText(this.appState.draft, 'RECONNECTED-OK'));
    this.appState.publish();
    const restarted = await this.server.start(port);
    if (restarted.state !== 'running') {
      throw new Error(restarted.message ?? 'the server did not restart');
    }
    await this.waitForText(win, 'RECONNECTED-OK', RECONNECT_TIMEOUT_MS);
    if ((await this.domFlag(win)) !== flag) throw new Error('the output page reloaded');
  }

  private async checkPersistence(): Promise<void> {
    this.appState.flush();
    const id = this.appState.projectId;
    this.store.save(this.appState.file);
    this.store.save(this.appState.file);
    const reopened = new ProjectStore(this.paths.projects);
    const loaded = reopened.load(id);
    const saved = canonical(this.appState.file);
    const reloaded = canonical(loaded.file);
    if (reloaded !== saved) {
      throw new Error(`a reloaded project differs from the saved one ${firstDifference(saved, reloaded)}`);
    }
    const filePath = path.join(this.paths.projects, `${id}.neonstage.json`);
    fs.writeFileSync(filePath, '{ this is not a project');
    const recovered = reopened.load(id);
    if (!recovered.notices.some((notice) => notice.includes('restored'))) {
      throw new Error('no backup recovery notice was produced');
    }
    if (canonical(recovered.file) !== saved) {
      throw new Error('the recovered project differs from the saved one');
    }
  }

  private async checkExport(): Promise<void> {
    this.secrets.set('twitch.accessToken', SECRETS[0]!);
    this.secrets.set('twitch.refreshToken', SECRETS[1]!);
    this.secrets.set('youtube.clientSecret', SECRETS[2]!);
    const exported = buildExport(this.appState.file, this.assets);
    const target = path.join(this.tmp, 'export.neonstage.json');
    fs.writeFileSync(target, exported.json);
    const content = fs.readFileSync(target, 'utf8');
    for (const secret of SECRETS) {
      if (content.includes(secret)) throw new Error(`the export contains ${secret}`);
    }
    if (content.includes('C:\\\\') || content.includes('C:\\')) {
      throw new Error('the export contains an absolute Windows path');
    }
    if (content.includes(this.tmp)) throw new Error('the export contains the data directory');
    if (content.includes(os.homedir())) throw new Error('the export contains the home directory');
  }

  private async checkReadOnly(): Promise<void> {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await request(this.port, '/health', { method });
      if (res.status !== 405) throw new Error(`${method} /health returned ${res.status}`);
    }
    const traversal = await request(this.port, '/media/../index.html');
    if (traversal.status !== 404) {
      throw new Error(`/media/../index.html returned ${traversal.status}`);
    }
    for (const pathname of ['/api/state', '/api/settings', '/api/secrets', '/api/projects']) {
      const res = await request(this.port, pathname);
      if (res.status !== 404) throw new Error(`${pathname} returned ${res.status}`);
    }
  }

  private openSse(pathname: string): SseClient {
    const client = new SseClient(this.port, pathname);
    this.clients.add(client);
    return client;
  }

  private async openOutput(outputPath: string): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.windows.add(win);
    win.on('closed', () => this.windows.delete(win));
    await win.loadURL(`http://127.0.0.1:${this.port}${outputPath}`);
    await win.webContents.executeJavaScript(
      `window.__nsSelftestLoad = ${JSON.stringify(this.loadFlag)}; true`,
    );
    return win;
  }

  private requireOutputWindow(): BrowserWindow {
    if (!this.outputWindow || this.outputWindow.isDestroyed()) {
      throw new Error('the output window is not open');
    }
    return this.outputWindow;
  }

  private async capture(win: BrowserWindow): Promise<NativeImage> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const image = await win.webContents.capturePage();
        if (image.getSize().width > 0) return image;
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw new Error(
      `capturePage failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async domText(win: BrowserWindow): Promise<string> {
    const value = (await win.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
    )) as unknown;
    return typeof value === 'string' ? value : '';
  }

  private async domFlag(win: BrowserWindow): Promise<string> {
    const value = (await win.webContents.executeJavaScript(
      'window.__nsSelftestLoad || ""',
    )) as unknown;
    return typeof value === 'string' ? value : '';
  }

  private async waitForText(win: BrowserWindow, needle: string, timeoutMs: number): Promise<void> {
    await waitFor(
      async () => {
        if (win.isDestroyed()) throw new Error('the output window was closed');
        const text = await this.domText(win);
        return text.includes(needle) ? true : null;
      },
      timeoutMs,
      `"${needle}" in the output DOM`,
    );
  }

  private async cleanup(): Promise<void> {
    for (const client of [...this.clients]) client.close();
    this.clients.clear();
    for (const win of [...this.windows]) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
    try {
      this.runtimeHost?.dispose();
    } catch {}
    try {
      this.providers?.dispose();
    } catch {}
    try {
      this.appState?.flush();
    } catch {}
    try {
      await this.server?.stop();
    } catch {}
    try {
      this.hub?.dispose();
    } catch {}
  }

  private emit(line: string): void {
    this.lines.push(line);
    console.log(line);
  }

  private writeLog(): void {
    try {
      fs.writeFileSync(path.join(this.tmp, 'selftest.log'), `${this.lines.join('\n')}\n`);
    } catch {
      return;
    }
  }

  private removeTempDir(): void {
    try {
      fs.rmSync(this.tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {}
    try {
      const script = `setTimeout(() => { try { require('node:fs').rmSync(${JSON.stringify(this.tmp)}, { recursive: true, force: true }); } catch {} }, 1500);`;
      const child = spawn(process.execPath, ['-e', script], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
      this.emit(`NOTE temp dir removal deferred to a background process: ${this.tmp}`);
    } catch (error) {
      this.emit(
        `NOTE could not remove ${this.tmp}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function runSelfTest(options: SelfTestOptions): Promise<number> {
  const run = new SelfTestRun(options);
  return run.execute();
}
