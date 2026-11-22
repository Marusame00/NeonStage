import { describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_LIMIT,
  applyChatOps,
  isAllowedMediaUrl,
  sanitizeChatMessage,
  toBroadcastSafe,
  type ChatMessage,
  type ChatOp,
  type ChatSnapshot,
} from '../src/shared/chat';

function message(id: string, authorId = 'u1', sourceKey = 'demo:twitch'): ChatMessage {
  return {
    id,
    sourceKey,
    platform: 'demo',
    demo: true,
    ts: 0,
    author: { id: authorId, name: `user-${authorId}`, badges: [] },
    segments: [{ t: 'text', text: `hello ${id}` }],
    kind: 'message',
    meta: {},
  };
}

describe('applyChatOps', () => {
  it('bounds history to the limit', () => {
    const ops: ChatOp[] = [];
    for (let index = 0; index < CHAT_HISTORY_LIMIT + 5; index += 1) {
      ops.push({ t: 'add', sourceKey: 'demo:twitch', message: message(`m${index}`) });
    }
    const snapshot = applyChatOps({}, ops);
    const list = snapshot['demo:twitch']!;
    expect(list).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(list[0]!.id).toBe('m5');
    expect(list[list.length - 1]!.id).toBe(`m${CHAT_HISTORY_LIMIT + 4}`);
  });

  it('deletes a single message', () => {
    const snapshot: ChatSnapshot = { 'demo:twitch': [message('a'), message('b')] };
    const next = applyChatOps(snapshot, [{ t: 'delete', sourceKey: 'demo:twitch', messageId: 'a' }]);
    expect(next['demo:twitch']!.map((entry) => entry.id)).toEqual(['b']);
    expect(snapshot['demo:twitch']).toHaveLength(2);
  });

  it('clears one user and clears a source', () => {
    const snapshot: ChatSnapshot = {
      'demo:twitch': [message('a', 'u1'), message('b', 'u2'), message('c', 'u1')],
    };
    const cleared = applyChatOps(snapshot, [
      { t: 'clearUser', sourceKey: 'demo:twitch', authorId: 'u1' },
    ]);
    expect(cleared['demo:twitch']!.map((entry) => entry.id)).toEqual(['b']);

    const emptied = applyChatOps(cleared, [{ t: 'clear', sourceKey: 'demo:twitch' }]);
    expect(emptied['demo:twitch']).toEqual([]);
  });

  it('keeps untouched sources by reference', () => {
    const other = [message('x', 'u9', 'demo:youtube')];
    const snapshot: ChatSnapshot = { 'demo:youtube': other };
    const next = applyChatOps(snapshot, [{ t: 'add', sourceKey: 'demo:twitch', message: message('a') }]);
    expect(next['demo:youtube']).toBe(other);
  });
});

describe('media urls', () => {
  it('allows only https provider CDNs', () => {
    expect(isAllowedMediaUrl('https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/1.0')).toBe(true);
    expect(isAllowedMediaUrl('https://yt3.ggpht.com/abc')).toBe(true);
    expect(isAllowedMediaUrl('https://lh3.googleusercontent.com/abc')).toBe(true);
    expect(isAllowedMediaUrl('http://static-cdn.jtvnw.net/emoticons/v2/1')).toBe(false);
    expect(isAllowedMediaUrl('https://evil.example.com/a.png')).toBe(false);
    expect(isAllowedMediaUrl('https://static-cdn.jtvnw.net.evil.com/a.png')).toBe(false);
    expect(isAllowedMediaUrl('not a url')).toBe(false);
  });
});

describe('sanitizeChatMessage', () => {
  it('drops disallowed urls and clamps text', () => {
    const dirty: ChatMessage = {
      ...message('a'),
      segments: [
        { t: 'text', text: 'x'.repeat(900) },
        { t: 'emote', id: '1', name: 'Kappa', url: 'https://static-cdn.jtvnw.net/emote/1' },
        { t: 'emote', id: '2', name: 'Bad', url: 'https://evil.example.com/emote' },
      ],
      author: {
        id: 'u1',
        name: 'user',
        color: 'red',
        badges: [{ id: 'b', label: 'Badge', imageUrl: 'https://evil.example.com/badge.png' }],
        avatarUrl: 'https://evil.example.com/avatar.png',
      },
    };

    const clean = sanitizeChatMessage(dirty);
    expect(clean.segments).toHaveLength(2);
    expect(clean.segments[0]).toEqual({ t: 'text', text: 'x'.repeat(500) });
    expect(clean.segments[1]!.t).toBe('emote');
    expect(clean.author.color).toBeUndefined();
    expect(clean.author.avatarUrl).toBeUndefined();
    expect(clean.author.badges[0]!.imageUrl).toBeUndefined();
  });

  it('keeps valid colors and caps segment count', () => {
    const many: ChatMessage = {
      ...message('a'),
      segments: Array.from({ length: 150 }, () => ({ t: 'text' as const, text: 'hi' })),
      author: { id: 'u1', name: 'user', color: '#AABBCC', badges: [] },
    };
    const clean = sanitizeChatMessage(many);
    expect(clean.segments).toHaveLength(100);
    expect(clean.author.color).toBe('#AABBCC');
  });
});

describe('toBroadcastSafe', () => {
  it('maps source states without account data', () => {
    const safe = toBroadcastSafe([
      {
        provider: 'twitch',
        state: 'connected',
        account: 'someone',
        message: 'secret detail',
        sources: [
          { key: 'twitch:someone', state: 'live', detail: 'internal' },
          { key: 'demo:twitch', state: 'demo' },
        ],
      },
      {
        provider: 'youtube',
        state: 'error',
        message: 'quota exceeded',
        sources: [{ key: 'youtube:mine', state: 'offline' }],
      },
    ]);
    expect(safe).toEqual({
      'twitch:someone': 'live',
      'demo:twitch': 'demo',
      'youtube:mine': 'offline',
    });
    expect(JSON.stringify(safe)).not.toContain('secret detail');
    expect(JSON.stringify(safe)).not.toContain('quota exceeded');
    expect(JSON.stringify(safe)).not.toContain('internal');
  });
});
