import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDoc } from '../src/shared/model';
import { addNode, createWidgetNode, groupNodes, setVisible, updateNode } from '../src/shared/ops';
import {
  buildOutputScene,
  outputPaths,
  parseOutputPath,
  recommendedSize,
  type OutputTarget,
} from '../src/shared/output';

function makeDoc(): { doc: ProjectDoc; sceneId: string; a: string; b: string; groupId: string } {
  const base = createEmptyProject('Output');
  const sceneId = base.scenes[0]!.id;
  const a = createWidgetNode('text', 100, 100, { w: 200, h: 100 });
  const b = createWidgetNode('text', 400, 300, { w: 200, h: 100 });
  let scene = addNode(base.scenes[0]!, a);
  scene = addNode(scene, b);
  const grouped = groupNodes(scene, [a.id, b.id], 'G');
  return { doc: { ...base, scenes: [grouped.scene] }, sceneId, a: a.id, b: b.id, groupId: grouped.groupId };
}

describe('buildOutputScene', () => {
  it('excludes hidden nodes', () => {
    const { doc, sceneId, a, b } = makeDoc();
    const hidden: ProjectDoc = { ...doc, scenes: [setVisible(doc.scenes[0]!, [a], false)] };
    const output = buildOutputScene(hidden, sceneId, { kind: 'scene', sceneId })!;
    expect(output.nodes.map((node) => node.id)).toEqual([b]);
  });

  it('excludes children of a hidden group', () => {
    const { doc, sceneId, groupId } = makeDoc();
    const hidden: ProjectDoc = { ...doc, scenes: [setVisible(doc.scenes[0]!, [groupId], false)] };
    const output = buildOutputScene(hidden, sceneId, { kind: 'scene', sceneId })!;
    expect(output.nodes).toEqual([]);
  });

  it('multiplies effective opacity through ancestors', () => {
    const { doc, sceneId, a, groupId } = makeDoc();
    const scene = updateNode(updateNode(doc.scenes[0]!, groupId, { opacity: 0.5 }), a, { opacity: 0.5 });
    const output = buildOutputScene({ ...doc, scenes: [scene] }, sceneId, { kind: 'scene', sceneId })!;
    const node = output.nodes.find((entry) => entry.id === a)!;
    expect(node.opacity).toBe(0.25);
  });

  it('strips editor-only data', () => {
    const { doc, sceneId } = makeDoc();
    const output = buildOutputScene(doc, sceneId, { kind: 'scene', sceneId })!;
    for (const node of output.nodes) {
      expect(Object.keys(node).sort()).toEqual(
        ['depth', 'h', 'id', 'opacity', 'parentId', 'style', 'type', 'w', 'widget', 'x', 'y'].sort(),
      );
    }
  });

  it('computes an isolated viewport from overflow and padding', () => {
    const base = createEmptyProject('Viewport');
    const sceneId = base.scenes[0]!.id;
    const node = createWidgetNode('text', 100, 100, {
      w: 200,
      h: 100,
      output: { padding: 8 },
      style: {
        glowEnabled: true,
        glowSize: 10,
        shadowEnabled: true,
        shadowX: 6,
        shadowY: 0,
        shadowBlur: 12,
      },
    });
    const doc: ProjectDoc = { ...base, scenes: [addNode(base.scenes[0]!, node)] };

    const output = buildOutputScene(doc, sceneId, { kind: 'object', sceneId, nodeId: node.id })!;
    expect(output.viewport).toEqual({ x: 74, y: 74, w: 252, h: 152 });
    expect(output.nodes[0]!.x).toBe(26);
    expect(output.nodes[0]!.y).toBe(26);
    expect(recommendedSize(output)).toEqual({ width: 252, height: 152 });
  });

  it('uses the union of children for a group viewport', () => {
    const { doc, sceneId, groupId } = makeDoc();
    const output = buildOutputScene(doc, sceneId, { kind: 'group', sceneId, nodeId: groupId })!;
    expect(output.viewport).toEqual({ x: 100, y: 100, w: 500, h: 300 });
    expect(output.nodes.map((node) => [node.x, node.y])).toEqual([
      [0, 0],
      [300, 200],
    ]);
  });

  it('returns null for a missing scene or node', () => {
    const { doc, sceneId } = makeDoc();
    expect(buildOutputScene(doc, sceneId, { kind: 'scene', sceneId: 'missing' })).toBeNull();
    expect(
      buildOutputScene(doc, sceneId, { kind: 'object', sceneId, nodeId: 'missing' }),
    ).toBeNull();
  });

  it('returns an empty scene for a hidden target', () => {
    const base = createEmptyProject('Hidden');
    const sceneId = base.scenes[0]!.id;
    const node = createWidgetNode('text', 100, 100, { w: 200, h: 100 });
    const scene = setVisible(addNode(base.scenes[0]!, node), [node.id], false);
    const doc: ProjectDoc = { ...base, scenes: [scene] };

    const output = buildOutputScene(doc, sceneId, { kind: 'object', sceneId, nodeId: node.id })!;
    expect(output.nodes).toEqual([]);
    expect(output.viewport).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it('excludes unknown widget kinds', () => {
    const base = createEmptyProject('Unknown');
    const sceneId = base.scenes[0]!.id;
    const node = createWidgetNode('text', 0, 0);
    const scene = addNode(base.scenes[0]!, node);
    const patched = {
      ...scene,
      nodes: {
        ...scene.nodes,
        [node.id]: { ...node, widget: { kind: 'not-registered', version: 1, props: {} } },
      },
    };
    const output = buildOutputScene({ ...base, scenes: [patched] }, sceneId, {
      kind: 'scene',
      sceneId,
    })!;
    expect(output.nodes).toEqual([]);
  });

  it('renders a widget for a lenient group target', () => {
    const base = createEmptyProject('Lenient');
    const sceneId = base.scenes[0]!.id;
    const node = createWidgetNode('text', 10, 20, { w: 100, h: 50 });
    const doc: ProjectDoc = { ...base, scenes: [addNode(base.scenes[0]!, node)] };
    const output = buildOutputScene(doc, sceneId, { kind: 'group', sceneId, nodeId: node.id })!;
    expect(output.nodes.map((entry) => entry.id)).toEqual([node.id]);
    expect(output.viewport).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
});

describe('output paths', () => {
  it('round-trips every target kind', () => {
    const targets: OutputTarget[] = [
      { kind: 'live' },
      { kind: 'scene', sceneId: 'sc-abc' },
      { kind: 'object', sceneId: 'sc-abc', nodeId: 'nd-1' },
      { kind: 'group', sceneId: 'sc-abc', nodeId: 'gr-2' },
    ];
    for (const target of targets) {
      const paths = outputPaths(target);
      expect(parseOutputPath(paths.outputPath)).toEqual(target);
      expect(parseOutputPath(paths.eventsPath, 'events')).toEqual(target);
      expect(parseOutputPath(paths.outputPath, 'events')).toBeNull();
    }
  });

  it('rejects malformed paths', () => {
    expect(parseOutputPath('/output/scene/../x')).toBeNull();
    expect(parseOutputPath('/output/scene/sc-abc/object/../x')).toBeNull();
    expect(parseOutputPath('/output/live/extra')).toBeNull();
    expect(parseOutputPath('/nope')).toBeNull();
    expect(parseOutputPath('/output/')).toBeNull();
  });
});
