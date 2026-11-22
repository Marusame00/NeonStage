export interface ChatBadge {
  id: string;
  label: string;
  imageUrl?: string;
}

export interface ChatAuthor {
  id: string;
  name: string;
  color?: string;
  badges: ChatBadge[];
  avatarUrl?: string;
}

export type ChatSegment =
  | { t: 'text'; text: string }
  | { t: 'emote'; id: string; name: string; url: string }
  | { t: 'mention'; text: string };

export type ChatPlatform = 'twitch' | 'youtube' | 'demo';
export type ChatMessageKind = 'message' | 'event' | 'system' | 'action';

export interface ChatMessage {
  id: string;
  sourceKey: string;
  platform: ChatPlatform;
  demo?: boolean;
  ts: number;
  author: ChatAuthor;
  segments: ChatSegment[];
  kind: ChatMessageKind;
  amountText?: string;
  meta: Record<string, unknown>;
}

export type ChatOp =
  | { t: 'add'; sourceKey: string; message: ChatMessage }
  | { t: 'delete'; sourceKey: string; messageId: string }
  | { t: 'clearUser'; sourceKey: string; authorId: string }
  | { t: 'clear'; sourceKey: string };

export type ChatSnapshot = Record<string, ChatMessage[]>;

export const CHAT_HISTORY_LIMIT = 200;

export const ALLOWED_MEDIA_HOSTS = [
  'static-cdn.jtvnw.net',
  'yt3.ggpht.com',
  'yt4.ggpht.com',
  'lh3.googleusercontent.com',
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SEGMENT_TEXT = 500;
const MAX_SEGMENTS = 100;

export function isAllowedMediaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_MEDIA_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function normalizeColor(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : undefined;
}

export function sanitizeChatMessage(message: ChatMessage): ChatMessage {
  const segments: ChatSegment[] = [];
  for (const segment of message.segments.slice(0, MAX_SEGMENTS)) {
    if (segment.t === 'emote') {
      if (!isAllowedMediaUrl(segment.url)) continue;
      segments.push({ t: 'emote', id: segment.id.slice(0, 100), name: segment.name.slice(0, 100), url: segment.url });
    } else {
      segments.push({ t: segment.t, text: segment.text.slice(0, MAX_SEGMENT_TEXT) });
    }
  }

  const badges: ChatBadge[] = [];
  for (const badge of message.author.badges.slice(0, 20)) {
    const imageUrl = badge.imageUrl && isAllowedMediaUrl(badge.imageUrl) ? badge.imageUrl : undefined;
    badges.push(
      imageUrl
        ? { id: badge.id.slice(0, 100), label: badge.label.slice(0, 100), imageUrl }
        : { id: badge.id.slice(0, 100), label: badge.label.slice(0, 100) },
    );
  }

  const avatarUrl =
    message.author.avatarUrl && isAllowedMediaUrl(message.author.avatarUrl)
      ? message.author.avatarUrl
      : undefined;
  const color = normalizeColor(message.author.color);

  return {
    ...message,
    segments,
    author: {
      id: message.author.id.slice(0, 100),
      name: message.author.name.slice(0, 100),
      badges,
      ...(color ? { color } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
}

export function applyChatOps(snapshot: ChatSnapshot, ops: ChatOp[]): ChatSnapshot {
  const next: ChatSnapshot = { ...snapshot };
  const touched = new Set<string>();

  for (const op of ops) {
    const sourceKey = op.sourceKey;
    if (!touched.has(sourceKey)) {
      next[sourceKey] = [...(snapshot[sourceKey] ?? [])];
      touched.add(sourceKey);
    }
    const list = next[sourceKey]!;

    switch (op.t) {
      case 'add': {
        list.push(sanitizeChatMessage(op.message));
        if (list.length > CHAT_HISTORY_LIMIT) list.splice(0, list.length - CHAT_HISTORY_LIMIT);
        break;
      }
      case 'delete': {
        const index = list.findIndex((message) => message.id === op.messageId);
        if (index >= 0) list.splice(index, 1);
        break;
      }
      case 'clearUser': {
        next[sourceKey] = list.filter((message) => message.author.id !== op.authorId);
        break;
      }
      case 'clear': {
        next[sourceKey] = [];
        break;
      }
    }
  }

  return next;
}

export type ProviderState =
  | 'disconnected'
  | 'needs-setup'
  | 'authorizing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type SourceState = 'live' | 'connecting' | 'offline' | 'demo';

export interface ProviderSourceStatus {
  key: string;
  state: SourceState;
  detail?: string;
}

export interface ProviderStatus {
  provider: 'twitch' | 'youtube';
  state: ProviderState;
  mode?: 'anonymous' | 'signed-in';
  account?: string;
  message?: string;
  sources: ProviderSourceStatus[];
}

export type BroadcastSafeStatus = Record<string, 'live' | 'connecting' | 'offline' | 'demo'>;

export function toBroadcastSafe(providers: ProviderStatus[]): BroadcastSafeStatus {
  const safe: BroadcastSafeStatus = {};
  for (const provider of providers) {
    for (const source of provider.sources) safe[source.key] = source.state;
  }
  return safe;
}
