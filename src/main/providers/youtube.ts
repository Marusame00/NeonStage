import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type {
  ChatBadge,
  ChatMessage,
  ChatOp,
  ProviderState,
  ProviderStatus,
  SourceState,
} from '../../shared/chat';
import { sanitizeChatMessage } from '../../shared/chat';
import type { YouTubeBroadcast } from '../../shared/ipc';
import type { DataSourceRequest } from '../../widgets/contract';
import type { ChatAdapter, ChatSink } from './manager';
import {
  systemTimers,
  type AdapterDeps,
  type FetchLike,
  type ProviderTimers,
} from './deps';

export type LoopbackHandler = (url: URL) => string;

export interface LoopbackServer {
  port: number;
  close(): void;
}

export type LoopbackFactory = (handler: LoopbackHandler) => Promise<LoopbackServer>;

export interface YouTubeAdapterDeps extends AdapterDeps {
  loopback?: LoopbackFactory;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const MINE_RETRY_MS = 60 * 1000;
const MAX_POLL_MS = 120_000;
const BACKLOG_LIMIT = 20;
const CLOSE_HTML =
  '<!doctype html><meta charset="utf-8"><title>NeonStage</title><p>NeonStage: you can close this tab.</p>';

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const defaultLoopback: LoopbackFactory = (handler) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = CLOSE_HTML;
      try {
        body = handler(new URL(req.url ?? '/', 'http://127.0.0.1'));
      } catch {
        body = CLOSE_HTML;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });

interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  channelTitle: string;
}

interface SourceEntry {
  req: DataSourceRequest;
  sink: ChatSink;
  state: SourceState;
  detail?: string;
  liveChatId: string | null;
  retryTimer: unknown;
}

interface PendingAuth {
  verifier: string;
  state: string;
  redirectUri: string;
  server: LoopbackServer;
  timeout: unknown;
  cancelled: boolean;
}

interface Poller {
  liveChatId: string;
  keys: Set<string>;
  timer: unknown;
  pageToken: string | null;
  intervalMs: number;
  first: boolean;
  stopped: boolean;
  running: boolean;
}

interface ChatSnippet {
  type?: string;
  publishedAt?: string;
  displayMessage?: string;
  textMessageDetails?: { messageText?: string };
  superChatDetails?: { amountDisplayString?: string };
  superStickerDetails?: { amountDisplayString?: string };
  deletedMessageDetails?: { deletedMessageId?: string };
  userBannedDetails?: { bannedUserDetails?: { channelId?: string } };
}

interface ChatAuthorDetails {
  channelId?: string;
  displayName?: string;
  profileImageUrl?: string;
  isVerified?: boolean;
  isChatOwner?: boolean;
  isChatSponsor?: boolean;
  isChatModerator?: boolean;
}

interface ChatItem {
  id?: string;
  snippet?: ChatSnippet;
  authorDetails?: ChatAuthorDetails;
}

interface BroadcastItem {
  id?: string;
  snippet?: { title?: string; liveChatId?: string; scheduledStartTime?: string };
  status?: { lifeCycleStatus?: string };
}

interface VideoItem {
  id?: string;
  liveStreamingDetails?: { activeLiveChatId?: string };
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export class YouTubeChatAdapter implements ChatAdapter {
  private readonly sources = new Map<string, SourceEntry>();
  private readonly pollers = new Map<string, Poller>();
  private readonly timers: ProviderTimers;
  private readonly loopback: LoopbackFactory;
  private tokens: YouTubeTokens | null;
  private state: ProviderState = 'needs-setup';
  private message: string | undefined;
  private account: string | undefined;
  private pending: PendingAuth | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(readonly deps: YouTubeAdapterDeps) {
    this.timers = deps.timers ?? systemTimers;
    this.loopback = deps.loopback ?? defaultLoopback;
    this.tokens = deps.secrets.get<YouTubeTokens>('youtube.tokens');
    void this.restore();
  }

  private get fetchImpl(): FetchLike {
    return this.deps.fetch ?? fetch;
  }

  private clientId(): string {
    return this.deps.secrets.get<string>('youtube.clientId') ?? '';
  }

  private clientSecret(): string {
    return this.deps.secrets.get<string>('youtube.clientSecret') ?? '';
  }

  private minPollMs(): number {
    const value = this.deps.secrets.get<number>('youtube.minPollMs');
    return typeof value === 'number' && value >= 2000 ? value : 5000;
  }

  async configure(clientId: string, clientSecret: string, minPollMs?: number): Promise<void> {
    const changed = this.clientId() !== clientId || this.clientSecret() !== clientSecret;
    if (changed && this.tokens) await this.signOut();
    this.deps.secrets.set('youtube.clientId', clientId);
    this.deps.secrets.set('youtube.clientSecret', clientSecret);
    if (typeof minPollMs === 'number') this.deps.secrets.set('youtube.minPollMs', minPollMs);
    if (changed && !this.tokens && this.state !== 'authorizing') {
      this.setState('disconnected', 'Not signed in to YouTube.');
    }
  }

  async startAuth(): Promise<void> {
    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret) {
      throw new Error('Save your YouTube client ID and secret first.');
    }
    this.cancelAuth();
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('hex');
    const server = await this.loopback((url) => this.handleCallback(url));
    const redirectUri = `http://127.0.0.1:${server.port}`;
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('code_challenge', codeChallenge(verifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    const pending: PendingAuth = {
      verifier,
      state,
      redirectUri,
      server,
      timeout: null,
      cancelled: false,
    };
    this.pending = pending;
    this.setState('authorizing', 'Waiting for you to approve NeonStage in your browser.');
    pending.timeout = this.timers.setTimeout(() => {
      this.failAuth('YouTube sign-in timed out — try Connect again.');
    }, AUTH_TIMEOUT_MS);
    await this.deps.openExternal(authUrl.toString());
  }

  cancelAuth(): void {
    const pending = this.pending;
    if (!pending) return;
    pending.cancelled = true;
    this.timers.clearTimeout(pending.timeout);
    pending.server.close();
    this.pending = null;
    if (this.state === 'authorizing') {
      this.setState(
        this.tokens ? 'connected' : 'disconnected',
        this.tokens ? undefined : 'Not signed in to YouTube.',
      );
    }
  }

  async signOut(): Promise<void> {
    const tokens = this.tokens;
    this.cancelAuth();
    this.clearTokens();
    this.stopAllPollers();
    this.account = undefined;
    this.setState('disconnected', 'Not signed in to YouTube.');
    this.markSources('offline', 'Not signed in to YouTube.');
    if (!tokens) return;
    try {
      await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(tokens.accessToken)}`, {
        method: 'POST',
      });
    } catch {
      this.deps.log.warn('YouTube token revoke failed');
    }
  }

  async reconnect(): Promise<void> {
    if (!this.tokens) throw new Error('Connect YouTube first.');
    this.setState('reconnecting', 'Reconnecting to YouTube…');
    if (!(await this.refresh())) return;
    this.setState('connected');
    this.resolveAll();
  }

  async listBroadcasts(): Promise<YouTubeBroadcast[]> {
    if (!this.tokens) throw new Error('Connect YouTube first.');
    const out: YouTubeBroadcast[] = [];
    for (const status of ['active', 'upcoming'] as const) {
      const res = await this.api<{ items?: BroadcastItem[] }>(
        `/liveBroadcasts?part=snippet,status&broadcastStatus=${status}&broadcastType=all&maxResults=10`,
      );
      for (const item of res?.items ?? []) {
        out.push({
          id: item.id ?? '',
          title: item.snippet?.title ?? '',
          status: item.status?.lifeCycleStatus ?? status,
          liveChatId: item.snippet?.liveChatId ?? null,
          ...(item.snippet?.scheduledStartTime
            ? { scheduledStart: item.snippet.scheduledStartTime }
            : {}),
        });
      }
    }
    return out;
  }

  start(req: DataSourceRequest, sink: ChatSink): void {
    this.sources.set(req.key, {
      req,
      sink,
      state: 'offline',
      liveChatId: null,
      retryTimer: null,
    });
    void this.resolveSource(req.key);
  }

  stop(key: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    this.sources.delete(key);
    this.timers.clearTimeout(entry.retryTimer);
    if (entry.liveChatId) this.detach(key, entry.liveChatId);
  }

  status(): ProviderStatus {
    return {
      provider: 'youtube',
      state: this.state,
      ...(this.account && this.state === 'connected' ? { account: this.account } : {}),
      ...(this.message ? { message: this.message } : {}),
      sources: [...this.sources.entries()].map(([key, entry]) => ({
        key,
        state: entry.state,
        ...(entry.detail ? { detail: entry.detail } : {}),
      })),
    };
  }

  dispose(): void {
    this.cancelAuth();
    this.stopAllPollers();
    for (const entry of this.sources.values()) this.timers.clearTimeout(entry.retryTimer);
    this.sources.clear();
  }

  private setState(state: ProviderState, message?: string): void {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.deps.onStatusChange?.();
  }

  private setSource(key: string, state: SourceState, detail?: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    entry.state = state;
    entry.detail = detail;
    entry.sink.sourceState(key, state, detail);
  }

  private markSources(state: SourceState, detail?: string): void {
    for (const key of [...this.sources.keys()]) this.setSource(key, state, detail);
  }

  private persistTokens(): void {
    if (this.tokens) this.deps.secrets.set('youtube.tokens', this.tokens);
  }

  private clearTokens(): void {
    this.tokens = null;
    this.deps.secrets.delete('youtube.tokens');
  }

  private async restore(): Promise<void> {
    if (!this.clientId() || !this.clientSecret()) {
      this.setState(
        'needs-setup',
        'Add your YouTube OAuth client in Connections to enable live chat.',
      );
      return;
    }
    if (!this.tokens) {
      this.setState('disconnected', 'Not signed in to YouTube.');
      return;
    }
    this.setState('connecting', 'Checking YouTube sign-in…');
    if (!(await this.ensureToken())) return;
    await this.loadChannel();
  }

  private async loadChannel(): Promise<void> {
    const res = await this.api<{ items?: { snippet?: { title?: string } }[] }>(
      '/channels?part=snippet&mine=true',
    );
    const title = res?.items?.[0]?.snippet?.title;
    if (this.tokens) {
      this.tokens = { ...this.tokens, channelTitle: title ?? this.tokens.channelTitle };
      this.persistTokens();
    }
    this.account = title || this.tokens?.channelTitle || undefined;
    this.setState('connected');
    this.resolveAll();
  }

  private async ensureToken(): Promise<boolean> {
    if (!this.tokens) return false;
    if (this.tokens.expiresAt - this.timers.now() > 60_000) return true;
    return this.refresh();
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    const tokens = this.tokens;
    if (!tokens || !tokens.refreshToken) return false;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
      }),
    });
    if (!res.ok) {
      this.deps.log.warn(`YouTube token refresh failed (HTTP ${res.status})`);
      this.clearTokens();
      this.stopAllPollers();
      this.account = undefined;
      this.setState(
        'disconnected',
        'YouTube sign-in expired — connect again (Testing-mode apps expire after 7 days)',
      );
      this.markSources('offline', 'YouTube sign-in expired — connect again');
      return false;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return false;
    this.tokens = {
      ...tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: this.timers.now() + (data.expires_in ?? 3600) * 1000,
    };
    this.persistTokens();
    return true;
  }

  private handleCallback(url: URL): string {
    const pending = this.pending;
    if (!pending || pending.cancelled) return CLOSE_HTML;
    const state = url.searchParams.get('state') ?? '';
    if (state !== pending.state) {
      this.deps.log.warn('YouTube sign-in state mismatch');
      return CLOSE_HTML;
    }
    const error = url.searchParams.get('error');
    if (error) {
      this.failAuth('YouTube sign-in was cancelled.');
      return CLOSE_HTML;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      this.failAuth('YouTube sign-in did not return a code.');
      return CLOSE_HTML;
    }
    void this.exchange(code, pending);
    return CLOSE_HTML;
  }

  private async exchange(code: string, pending: PendingAuth): Promise<void> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: pending.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pending.verifier,
      }),
    });
    if (!res.ok) {
      this.deps.log.warn(`YouTube code exchange failed (HTTP ${res.status})`);
      this.failAuth('YouTube sign-in failed — try Connect again.');
      return;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      this.failAuth('YouTube sign-in failed — try Connect again.');
      return;
    }
    this.finishAuth();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: this.timers.now() + (data.expires_in ?? 3600) * 1000,
      channelTitle: '',
    };
    this.persistTokens();
    this.setState('connecting', 'Finishing YouTube sign-in…');
    await this.loadChannel();
  }

  private finishAuth(): void {
    const pending = this.pending;
    if (!pending) return;
    this.timers.clearTimeout(pending.timeout);
    pending.server.close();
    this.pending = null;
  }

  private failAuth(message: string): void {
    this.finishAuth();
    this.setState('error', message);
  }

  private resolveAll(): void {
    for (const key of [...this.sources.keys()]) void this.resolveSource(key);
  }

  private async resolveSource(key: string): Promise<void> {
    const entry = this.sources.get(key);
    if (!entry) return;
    if (!this.clientId() || !this.clientSecret()) {
      this.setSource(key, 'offline', 'YouTube integration not configured');
      return;
    }
    if (this.state !== 'connected' || !this.tokens) {
      this.setSource(key, 'connecting', 'Waiting for YouTube sign-in');
      return;
    }
    if (key === 'youtube:mine') {
      await this.resolveMine(key);
      return;
    }
    if (key.startsWith('youtube:video:')) {
      await this.resolveVideo(key, key.slice('youtube:video:'.length));
      return;
    }
    this.setSource(key, 'offline', 'YouTube source not recognised');
  }

  private async resolveMine(key: string): Promise<void> {
    const res = await this.api<{ items?: BroadcastItem[] }>(
      '/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all&maxResults=10',
    );
    if (!this.sources.has(key)) return;
    const liveChatId = res?.items?.[0]?.snippet?.liveChatId ?? null;
    if (!liveChatId) {
      this.setSource(key, 'offline', 'No active broadcast — retrying every 60 s');
      this.scheduleMineRetry(key);
      return;
    }
    this.attach(key, liveChatId);
  }

  private scheduleMineRetry(key: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    this.timers.clearTimeout(entry.retryTimer);
    entry.retryTimer = this.timers.setTimeout(() => {
      entry.retryTimer = null;
      void this.resolveSource(key);
    }, MINE_RETRY_MS);
  }

  private async resolveVideo(key: string, videoId: string): Promise<void> {
    const res = await this.api<{ items?: VideoItem[] }>(
      `/videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(videoId)}`,
    );
    if (!this.sources.has(key)) return;
    const liveChatId = res?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
    if (!liveChatId) {
      this.setSource(key, 'offline', 'This video has no active live chat');
      return;
    }
    this.attach(key, liveChatId);
  }

  private attach(key: string, liveChatId: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    entry.liveChatId = liveChatId;
    let poller = this.pollers.get(liveChatId);
    if (!poller) {
      poller = {
        liveChatId,
        keys: new Set<string>(),
        timer: null,
        pageToken: null,
        intervalMs: this.minPollMs(),
        first: true,
        stopped: false,
        running: false,
      };
      this.pollers.set(liveChatId, poller);
      this.setSource(key, 'connecting', 'Connecting to YouTube live chat');
      poller.keys.add(key);
      void this.poll(poller);
      return;
    }
    poller.keys.add(key);
    if (!poller.first) this.setSource(key, 'live');
    else this.setSource(key, 'connecting', 'Connecting to YouTube live chat');
  }

  private detach(key: string, liveChatId: string): void {
    const poller = this.pollers.get(liveChatId);
    if (!poller) return;
    poller.keys.delete(key);
    if (poller.keys.size > 0) return;
    this.stopPoller(poller);
  }

  private stopPoller(poller: Poller): void {
    poller.stopped = true;
    this.timers.clearTimeout(poller.timer);
    poller.timer = null;
    this.pollers.delete(poller.liveChatId);
  }

  private stopAllPollers(): void {
    for (const poller of [...this.pollers.values()]) this.stopPoller(poller);
  }

  private schedulePoll(poller: Poller, ms: number): void {
    if (poller.stopped) return;
    this.timers.clearTimeout(poller.timer);
    poller.timer = this.timers.setTimeout(() => {
      void this.poll(poller);
    }, ms);
  }

  private async poll(poller: Poller): Promise<void> {
    if (poller.stopped || poller.running) return;
    poller.running = true;
    try {
      await this.doPoll(poller);
    } finally {
      poller.running = false;
    }
  }

  private async doPoll(poller: Poller): Promise<void> {
    if (!(await this.ensureToken())) {
      this.schedulePoll(poller, this.minPollMs());
      return;
    }
    const params = new URLSearchParams({
      liveChatId: poller.liveChatId,
      part: 'snippet,authorDetails',
      maxResults: '200',
    });
    if (poller.pageToken) params.set('pageToken', poller.pageToken);
    const url = `${API}/liveChat/messages?${params.toString()}`;
    const send = (): Promise<Response> =>
      this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.tokens?.accessToken ?? ''}` },
      });
    let res = await send();
    if (res.status === 401) {
      if (!(await this.refresh())) return;
      res = await send();
    }
    if (!res.ok) {
      await this.handlePollError(poller, res);
      return;
    }
    const data = (await res.json()) as {
      pollingIntervalMillis?: number;
      nextPageToken?: string;
      offlineAt?: string;
      items?: ChatItem[];
    };
    if (poller.stopped) return;
    const items = Array.isArray(data.items) ? data.items : [];
    const visible = poller.first ? items.slice(-BACKLOG_LIMIT) : items;
    poller.first = false;
    poller.pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : null;
    poller.intervalMs = Math.max(
      typeof data.pollingIntervalMillis === 'number' ? data.pollingIntervalMillis : 0,
      this.minPollMs(),
    );
    for (const item of visible) {
      for (const key of [...poller.keys]) {
        const ops = this.itemOps(item, key);
        if (ops.length > 0) this.sources.get(key)?.sink.ops(ops);
      }
    }
    if (typeof data.offlineAt === 'string') {
      for (const key of [...poller.keys]) this.setSource(key, 'offline', 'Live chat ended');
      this.stopPoller(poller);
      return;
    }
    for (const key of [...poller.keys]) this.setSource(key, 'live');
    this.schedulePoll(poller, poller.intervalMs);
  }

  private async handlePollError(poller: Poller, res: Response): Promise<void> {
    const reason = await this.errorReason(res);
    this.deps.log.warn(`YouTube liveChat poll failed (HTTP ${res.status} ${reason})`);
    if (res.status === 403 && reason === 'quotaExceeded') {
      for (const key of [...poller.keys]) this.setSource(key, 'offline', 'YouTube quota exhausted');
      this.stopPoller(poller);
      this.setState('error', 'YouTube API daily quota exhausted — resets at midnight Pacific time');
      return;
    }
    if (res.status === 403 && reason === 'rateLimitExceeded') {
      poller.intervalMs = Math.min(poller.intervalMs * 2, MAX_POLL_MS);
      this.schedulePoll(poller, poller.intervalMs);
      return;
    }
    if (reason === 'liveChatEnded') {
      for (const key of [...poller.keys]) this.setSource(key, 'offline', 'Live chat ended');
      this.stopPoller(poller);
      return;
    }
    if (reason === 'liveChatNotFound' || reason === 'liveChatDisabled') {
      for (const key of [...poller.keys]) this.setSource(key, 'offline', 'Live chat is not available');
      this.stopPoller(poller);
      return;
    }
    if (res.status >= 500) {
      poller.intervalMs = Math.min(poller.intervalMs * 2, MAX_POLL_MS);
      this.schedulePoll(poller, poller.intervalMs);
      return;
    }
    for (const key of [...poller.keys]) {
      this.setSource(key, 'offline', `YouTube chat unavailable (HTTP ${res.status})`);
    }
    this.stopPoller(poller);
  }

  private async errorReason(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as {
        error?: { errors?: { reason?: string }[]; status?: string };
      };
      return body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
    } catch {
      return '';
    }
  }

  private itemOps(item: ChatItem, key: string): ChatOp[] {
    const snippet = item.snippet ?? {};
    const type = typeof snippet.type === 'string' ? snippet.type : '';
    if (type === 'messageDeletedEvent') {
      const id = snippet.deletedMessageDetails?.deletedMessageId;
      return id ? [{ t: 'delete', sourceKey: key, messageId: `yt:${id}` }] : [];
    }
    if (type === 'userBannedEvent') {
      const authorId = snippet.userBannedDetails?.bannedUserDetails?.channelId;
      return authorId ? [{ t: 'clearUser', sourceKey: key, authorId }] : [];
    }
    if (type === 'chatEndedEvent') return [];
    const display = typeof snippet.displayMessage === 'string' ? snippet.displayMessage : '';
    if (!display) return [];
    const author = item.authorDetails ?? {};
    const badges: ChatBadge[] = [];
    if (author.isChatOwner) badges.push({ id: 'owner', label: 'Owner' });
    if (author.isChatModerator) badges.push({ id: 'moderator', label: 'Moderator' });
    if (author.isChatSponsor) badges.push({ id: 'member', label: 'Member' });
    if (author.isVerified) badges.push({ id: 'verified', label: 'Verified' });
    const amountText =
      snippet.superChatDetails?.amountDisplayString ??
      snippet.superStickerDetails?.amountDisplayString;
    const isEvent = type === 'newSponsorEvent' || type === 'memberMilestoneChatEvent';
    const published = snippet.publishedAt ? Date.parse(snippet.publishedAt) : NaN;
    const message: ChatMessage = {
      id: `yt:${item.id ?? ''}`,
      sourceKey: key,
      platform: 'youtube',
      ts: Number.isFinite(published) ? published : this.timers.now(),
      author: {
        id: author.channelId ?? '',
        name: author.displayName ?? '',
        badges,
      },
      segments: [{ t: 'text', text: display }],
      kind: isEvent ? 'event' : 'message',
      ...(amountText ? { amountText } : {}),
      meta: { type, liveChatId: this.sources.get(key)?.liveChatId ?? '' },
    };
    return [{ t: 'add', sourceKey: key, message: sanitizeChatMessage(message) }];
  }

  private async api<T>(path: string): Promise<T | null> {
    if (!(await this.ensureToken())) return null;
    const send = (): Promise<Response> =>
      this.fetchImpl(`${API}${path}`, {
        headers: { Authorization: `Bearer ${this.tokens?.accessToken ?? ''}` },
      });
    let res = await send();
    if (res.status === 401) {
      if (!(await this.refresh())) return null;
      res = await send();
    }
    if (!res.ok) {
      this.deps.log.warn(`YouTube API ${path.split('?')[0]} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  }
}
