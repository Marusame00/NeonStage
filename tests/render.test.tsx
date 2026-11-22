import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '../src/shared/chat';
import { createEmptyProject, defaultStyle } from '../src/shared/model';
import { createWidgetNode } from '../src/shared/ops';
import { buildOutputScene, type OutputNode } from '../src/shared/output';
import { TEMPLATES } from '../src/shared/templates';
import { ChatStore, createRenderStores, type RenderStores } from '../src/render/stores';
import { RenderProvider } from '../src/render/RenderContext';
import { NodeView } from '../src/render/NodeView';
import { SceneRenderer } from '../src/render/SceneRenderer';
import { boxStyle, textStyle } from '../src/render/style';
import { getWidget } from '../src/widgets/registry';

function makeNode(
  kind: string,
  props: Record<string, unknown> = {},
  overrides: Partial<OutputNode> = {},
): OutputNode {
  const definition = getWidget(kind)!;
  return {
    id: 'nd-test',
    parentId: null,
    type: 'widget',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    opacity: 1,
    style: defaultStyle(),
    widget: {
      kind,
      version: definition.version,
      props: definition.validate({ ...definition.defaultProps(), ...props }),
    },
    depth: 0,
    ...overrides,
  };
}

function renderNode(node: OutputNode, mode: 'editor' | 'output', stores: RenderStores): string {
  return renderToStaticMarkup(
    <RenderProvider mode={mode} stores={stores} mediaUrl={(assetId) => `/media/${assetId}`}>
      <NodeView node={node} />
    </RenderProvider>,
  );
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sourceKey: 'twitch:test',
    platform: 'twitch',
    ts: 1_700_000_000_000,
    author: { id: 'user-1', name: 'viewer', badges: [] },
    segments: [{ t: 'text', text: 'hello' }],
    kind: 'message',
    meta: {},
    ...overrides,
  };
}

describe('frame widget placeholders', () => {
  it('draws the editor placeholder only in editor mode', () => {
    const node = makeNode('frame', { purpose: 'game', showPlaceholder: true });
    const output = renderNode(node, 'output', createRenderStores());
    expect(output).not.toContain('GAME CAPTURE AREA');
    expect(output).not.toContain('Editor only');

    const editor = renderNode(node, 'editor', createRenderStores());
    expect(editor).toContain('GAME CAPTURE AREA');
    expect(editor).toContain('Editor only');
  });
});

describe('chat rendering safety', () => {
  it('escapes markup and only renders allowlisted emotes as images', () => {
    const stores = createRenderStores();
    stores.status.set({ 'twitch:test': 'live' });
    stores.chat.reset({
      'twitch:test': [
        message({
          author: { id: 'user-1', name: '<b>x</b>', badges: [] },
          segments: [
            { t: 'text', text: '<img src=x onerror=alert(1)>' },
            { t: 'emote', id: 'e1', name: 'Kappa', url: 'https://evil.example/e.png' },
            {
              t: 'emote',
              id: 'e2',
              name: 'PogChamp',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/1.0',
            },
          ],
        }),
      ],
    });

    const node = makeNode('chat-twitch', { source: 'live', channel: 'test' });
    const markup = renderNode(node, 'output', stores);

    expect(markup).toContain('&lt;img');
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(markup).not.toContain('<img src="x"');
    expect(markup).toContain('Kappa');
    expect(markup).not.toContain('evil.example');
    expect(markup).toContain('src="https://static-cdn.jtvnw.net');
  });

  it('renders nothing for demo chat in output unless enabled', () => {
    const stores = createRenderStores();
    stores.chat.reset({
      'demo:twitch': [message({ sourceKey: 'demo:twitch', platform: 'demo', demo: true })],
    });

    const hidden = makeNode('chat-twitch', { source: 'demo' });
    const hiddenMarkup = renderNode(hidden, 'output', stores);
    expect(hiddenMarkup).not.toContain('hello');
    expect(hiddenMarkup).not.toContain('DEMO');

    const shown = makeNode('chat-twitch', { source: 'demo', showDemoInOutput: true });
    const markup = renderNode(shown, 'output', stores);
    expect(markup).toContain('DEMO');
    expect(markup).not.toContain('DEMO DATA');
  });
});

describe('scene rendering', () => {
  it('renders the synthwave template without editor-only markers', () => {
    const base = createEmptyProject('Render');
    const template = TEMPLATES.find((entry) => entry.id === 'synthwave-gameplay')!;
    const scene = template.build(1920, 1080);
    const output = buildOutputScene({ ...base, scenes: [scene] }, scene.id, {
      kind: 'scene',
      sceneId: scene.id,
    })!;

    const markup = renderToStaticMarkup(
      <RenderProvider mode="output" stores={createRenderStores()} mediaUrl={(id) => `/media/${id}`}>
        <SceneRenderer scene={output} />
      </RenderProvider>,
    );

    for (const forbidden of ['ns-editor', 'checker', 'selection', 'DEMO DATA', 'Editor only']) {
      expect(markup).not.toContain(forbidden);
    }
  });
});

describe('style helpers', () => {
  it('keeps background and text opacity independent', () => {
    const style = { ...defaultStyle(), bgColor: '#120a24', bgOpacity: 0.5, textOpacity: 1 };
    expect(boxStyle(style, ['background']).background).toBe('rgba(18, 10, 36, 0.5)');
    expect(textStyle(style, ['text']).color).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('timer rendering', () => {
  it('shows elapsed and countdown values from server time', () => {
    vi.useFakeTimers();
    try {
      const serverNow = 1_700_000_000_000;
      vi.setSystemTime(serverNow);
      const stores = createRenderStores();
      stores.runtime.set(
        {
          timers: { 'nd-timer': { running: true, startedAt: serverNow - 65_000, accumulatedMs: 0 } },
          goals: {},
          session: { startedAt: null },
        },
        serverNow,
      );

      const elapsed = makeNode('timer', { mode: 'elapsed', format: 'mm:ss', showLabel: false }, { id: 'nd-timer' });
      expect(renderNode(elapsed, 'output', stores)).toContain('01:05');

      const countdown = makeNode(
        'timer',
        { mode: 'countdown', durationMs: 600_000, format: 'mm:ss', showLabel: false },
        { id: 'nd-timer' },
      );
      expect(renderNode(countdown, 'output', stores)).toContain('08:55');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatStore', () => {
  it('notifies only listeners of touched sources and keeps other arrays stable', () => {
    const chat = new ChatStore();
    chat.reset({
      a: [message({ id: 'a-1', sourceKey: 'a' })],
      b: [message({ id: 'b-1', sourceKey: 'b' })],
    });

    const beforeA = chat.getSource('a');
    const beforeB = chat.getSource('b');
    let aCalls = 0;
    const unsubscribe = chat.subscribe('a', () => {
      aCalls += 1;
    });

    chat.apply([{ t: 'add', sourceKey: 'b', message: message({ id: 'b-2', sourceKey: 'b' }) }]);
    expect(aCalls).toBe(0);
    expect(chat.getSource('a')).toBe(beforeA);
    expect(chat.getSource('b')).not.toBe(beforeB);

    unsubscribe();
    chat.apply([{ t: 'add', sourceKey: 'a', message: message({ id: 'a-2', sourceKey: 'a' }) }]);
    expect(aCalls).toBe(0);
    expect(chat.getSource('a')).not.toBe(beforeA);
  });
});

describe('image widget', () => {
  it('registers a validated asset id and renders nothing in output without an asset', () => {
    const definition = getWidget('image')!;
    expect(definition.validate({ assetId: '../../etc/passwd' }).assetId).toBe('');
    const node = makeNode('image', { assetId: '' });
    expect(renderNode(node, 'output', createRenderStores())).not.toContain('<img');
    expect(renderNode(node, 'editor', createRenderStores())).toContain('No image selected');
  });
});

describe('widget node creation', () => {
  it('creates an image node through the registry', () => {
    const node = createWidgetNode('image', 0, 0);
    expect(node.widget?.kind).toBe('image');
  });
});
