import { describe, expect, it } from 'vitest';
import { createEmptyProject, createScene, type ProjectDoc, type Scene } from '../src/shared/model';
import {
  addNode,
  alignNodes,
  createWidgetNode,
  distributeNodes,
  duplicateNodes,
  getDescendants,
  getRenderOrder,
  groupNodes,
  moveNodes,
  moveNodeTo,
  recomputeGroupBounds,
  removeNodes,
  removeScene,
  reorder,
  setLocked,
  setNodeRect,
  setSceneSize,
  setVisible,
  ungroup,
  updateNode,
  updateNodeStyle,
  updateWidgetProps,
} from '../src/shared/ops';
import { deepFreeze } from './helpers';

function baseScene(): Scene {
  let scene = createScene('Test', 1920, 1080);
  scene = addNode(scene, createWidgetNode('text', 100, 100, { w: 200, h: 100 }));
  scene = addNode(scene, createWidgetNode('text', 400, 100, { w: 200, h: 100 }));
  return scene;
}

function ids(scene: Scene): [string, string] {
  return [scene.rootIds[0]!, scene.rootIds[1]!];
}

describe('addNode / removeNodes', () => {
  it('adds nodes in order and at an index', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const extra = createWidgetNode('shape', 0, 0);
    const withExtra = addNode(scene, extra, null, 1);
    expect(withExtra.rootIds).toEqual([a, extra.id, b]);
  });

  it('removes descendants and groups left empty', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');

    const removed = removeNodes(grouped.scene, [a]);
    expect(removed.nodes[a]).toBeUndefined();
    expect(removed.nodes[grouped.groupId]).toBeDefined();
    expect(removed.nodes[grouped.groupId]!.children).toEqual([b]);

    const emptied = removeNodes(removed, [b]);
    expect(emptied.nodes[grouped.groupId]).toBeUndefined();
    expect(emptied.rootIds).toEqual([]);
  });

  it('removes a whole subtree', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const cleared = removeNodes(grouped.scene, [grouped.groupId]);
    expect(cleared.rootIds).toEqual([]);
    expect(Object.keys(cleared.nodes)).toEqual([]);
  });
});

describe('moveNodes', () => {
  it('moves a group together with its children', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const before = grouped.scene.nodes[a]!;
    const moved = moveNodes(grouped.scene, [grouped.groupId], 10, 20);
    expect(moved.nodes[a]!.x).toBe(before.x + 10);
    expect(moved.nodes[a]!.y).toBe(before.y + 20);
    expect(moved.nodes[grouped.groupId]!.x).toBe(before.x + 10);
    expect(moved.nodes[grouped.groupId]!.y).toBe(before.y + 20);
  });

  it('skips locked nodes', () => {
    const scene = baseScene();
    const [a] = ids(scene);
    const locked = setLocked(scene, [a], true);
    const moved = moveNodes(locked, [a], 10, 10);
    expect(moved).toBe(locked);
    expect(moved.nodes[a]!.x).toBe(scene.nodes[a]!.x);
  });

  it('skips children of a locked group', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const locked = setLocked(grouped.scene, [grouped.groupId], true);
    const moved = moveNodes(locked, [a], 10, 10);
    expect(moved.nodes[a]!.x).toBe(grouped.scene.nodes[a]!.x);
  });
});

describe('duplicateNodes', () => {
  it('creates fresh ids inserted above the originals', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const { scene: dup, newIds } = duplicateNodes(scene, [a]);
    expect(newIds).toHaveLength(1);
    expect(dup.rootIds).toEqual([a, newIds[0], b]);
    expect(newIds[0]).not.toBe(a);
    expect(dup.nodes[newIds[0]!]!.x).toBe(scene.nodes[a]!.x + 24);
    expect(dup.nodes[newIds[0]!]!.y).toBe(scene.nodes[a]!.y + 24);
  });

  it('deep copies subtrees with fresh ids', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const { scene: dup, newIds } = duplicateNodes(grouped.scene, [grouped.groupId]);
    const copyId = newIds[0]!;
    expect(copyId).not.toBe(grouped.groupId);
    expect(dup.nodes[copyId]!.children).toHaveLength(2);
    for (const childId of dup.nodes[copyId]!.children) {
      expect(childId).not.toBe(a);
      expect(childId).not.toBe(b);
      expect(dup.nodes[childId]!.parentId).toBe(copyId);
    }
  });
});

describe('groupNodes / ungroup', () => {
  it('round-trips positions and z-order', () => {
    const scene = baseScene();
    const order = [...scene.rootIds];
    const positions = order.map((id) => ({ id, x: scene.nodes[id]!.x, y: scene.nodes[id]!.y }));

    const grouped = groupNodes(scene, order, 'G');
    expect(grouped.scene.rootIds).toEqual([grouped.groupId]);
    expect(grouped.scene.nodes[grouped.groupId]!.children).toEqual(order);

    const ungrouped = ungroup(grouped.scene, grouped.groupId);
    expect(ungrouped.scene.rootIds).toEqual(order);
    expect(ungrouped.childIds).toEqual(order);
    expect(ungrouped.scene.nodes[grouped.groupId]).toBeUndefined();
    for (const position of positions) {
      expect(ungrouped.scene.nodes[position.id]!.x).toBe(position.x);
      expect(ungrouped.scene.nodes[position.id]!.y).toBe(position.y);
      expect(ungrouped.scene.nodes[position.id]!.parentId).toBeNull();
    }
  });

  it('inserts the group at the highest member index', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const extra = createWidgetNode('shape', 0, 0);
    const withExtra = addNode(scene, extra);
    const grouped = groupNodes(withExtra, [a, extra.id], 'G');
    expect(grouped.scene.rootIds).toEqual([b, grouped.groupId]);
  });

  it('rejects nodes with different parents', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    expect(() => groupNodes(grouped.scene, [a, grouped.groupId], 'H')).toThrow();
  });
});

describe('reorder', () => {
  it('moves within the parent list', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    expect(reorder(scene, [a], 'forward').rootIds).toEqual([b, a]);
    expect(reorder(scene, [a], 'front').rootIds).toEqual([b, a]);
    expect(reorder(scene, [a], 'backward').rootIds).toEqual([a, b]);
    expect(reorder(scene, [a], 'back').rootIds).toEqual([a, b]);
    expect(reorder(reorder(scene, [a], 'front'), [a], 'back').rootIds).toEqual([a, b]);
  });
});

describe('moveNodeTo', () => {
  it('reorders within the same parent', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    expect(moveNodeTo(scene, a, null, 1).rootIds).toEqual([b, a]);
    expect(moveNodeTo(scene, b, null, 0).rootIds).toEqual([b, a]);
  });

  it('moves a node into a group keeping its absolute position', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [b], 'G');
    const moved = moveNodeTo(grouped.scene, a, grouped.groupId, 0);
    expect(moved.nodes[a]!.parentId).toBe(grouped.groupId);
    expect(moved.nodes[a]!.x).toBe(scene.nodes[a]!.x);
    expect(moved.nodes[a]!.y).toBe(scene.nodes[a]!.y);
    expect(moved.nodes[grouped.groupId]!.children).toEqual([a, b]);
    expect(moved.nodes[grouped.groupId]!.x).toBe(100);
    expect(moved.nodes[grouped.groupId]!.w).toBe(500);
    expect(moved.rootIds).toEqual([grouped.groupId]);
  });

  it('moves a node out of a group and drops the emptied group', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a], 'G');
    const moved = moveNodeTo(grouped.scene, a, null, 1);
    expect(moved.nodes[a]!.parentId).toBeNull();
    expect(moved.nodes[grouped.groupId]).toBeUndefined();
    expect(moved.rootIds).toEqual([b, a]);
    expect(moved.nodes[a]!.x).toBe(scene.nodes[a]!.x);
  });

  it('refuses to move a group into its own descendant', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const inner = groupNodes(scene, [a], 'Inner');
    const outer = groupNodes(inner.scene, [inner.groupId, b], 'Outer');
    const moved = moveNodeTo(outer.scene, outer.groupId, inner.groupId, 0);
    expect(moved).toBe(outer.scene);
    expect(moveNodeTo(outer.scene, outer.groupId, outer.groupId, 0)).toBe(outer.scene);
  });
});

describe('alignNodes / distributeNodes', () => {
  it('aligns to the canvas', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const left = alignNodes(scene, [a, b], 'left', 'canvas');
    expect(left.nodes[a]!.x).toBe(0);
    expect(left.nodes[b]!.x).toBe(0);
    const right = alignNodes(scene, [a, b], 'right', 'canvas');
    expect(right.nodes[a]!.x).toBe(1720);
    expect(right.nodes[b]!.x).toBe(1720);
    const centered = alignNodes(scene, [a, b], 'hcenter', 'canvas');
    expect(centered.nodes[a]!.x).toBe(860);
  });

  it('distributes equal gaps', () => {
    let scene = createScene('Distribute', 1920, 1080);
    const created = [0, 100, 1000].map((x) => createWidgetNode('shape', x, 0, { w: 100, h: 100 }));
    for (const node of created) scene = addNode(scene, node);
    const distributed = distributeNodes(scene, created.map((node) => node.id), 'h');
    const xs = created.map((node) => distributed.nodes[node.id]!.x);
    expect(xs).toEqual([0, 500, 1000]);
  });

  it('needs at least three nodes to distribute', () => {
    const scene = baseScene();
    expect(distributeNodes(scene, scene.rootIds, 'h')).toBe(scene);
  });
});

describe('setNodeRect', () => {
  it('enforces the minimum widget size', () => {
    const scene = baseScene();
    const [a] = ids(scene);
    const resized = setNodeRect(scene, a, { x: 10, y: 10, w: 1, h: 1 });
    expect(resized.nodes[a]!.w).toBe(40);
    expect(resized.nodes[a]!.h).toBe(24);
  });

  it('rescales a group arrangement', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const group = grouped.scene.nodes[grouped.groupId]!;
    const resized = setNodeRect(grouped.scene, grouped.groupId, {
      x: group.x,
      y: group.y,
      w: group.w * 2,
      h: group.h * 2,
    });
    expect(resized.nodes[a]!.w).toBe(grouped.scene.nodes[a]!.w * 2);
    expect(resized.nodes[a]!.h).toBe(grouped.scene.nodes[a]!.h * 2);
    expect(resized.nodes[b]!.x).toBe(group.x + (grouped.scene.nodes[b]!.x - group.x) * 2);
  });
});

describe('update helpers', () => {
  it('updates node fields and styles', () => {
    const scene = baseScene();
    const [a] = ids(scene);
    const moved = updateNode(scene, a, { x: 42 });
    expect(moved.nodes[a]!.x).toBe(42);
    const styled = updateNodeStyle(scene, [a], { fontSize: 64, glowEnabled: true });
    expect(styled.nodes[a]!.style.fontSize).toBe(64);
    expect(styled.nodes[a]!.style.glowEnabled).toBe(true);
    expect(styled.nodes[a]!.style.textColor).toBe(scene.nodes[a]!.style.textColor);
  });

  it('validates widget props through the registry', () => {
    let scene = createScene('Chat', 1920, 1080);
    const chat = createWidgetNode('chat-twitch', 0, 0);
    scene = addNode(scene, chat);
    const updated = updateWidgetProps(scene, chat.id, { maxMessages: 999 });
    expect(updated.nodes[chat.id]!.widget!.props.maxMessages).toBe(50);
  });

  it('toggles visibility and lock', () => {
    const scene = baseScene();
    const [a] = ids(scene);
    expect(setVisible(scene, [a], false).nodes[a]!.visible).toBe(false);
    expect(setLocked(scene, [a], true).nodes[a]!.locked).toBe(true);
  });
});

describe('scene helpers', () => {
  it('flattens render order depth-first', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    expect(getRenderOrder(grouped.scene)).toEqual([grouped.groupId, a, b]);
    expect(getDescendants(grouped.scene, grouped.groupId)).toEqual([a, b]);
  });

  it('recomputes group bounds from children', () => {
    const scene = baseScene();
    const [a, b] = ids(scene);
    const grouped = groupNodes(scene, [a, b], 'G');
    const moved = moveNodes(grouped.scene, [a], -50, -50);
    const recomputed = recomputeGroupBounds(moved, grouped.groupId);
    expect(recomputed.nodes[grouped.groupId]!.x).toBe(50);
    expect(recomputed.nodes[grouped.groupId]!.y).toBe(50);
  });
});

describe('project operations', () => {
  function docWithNode(): { doc: ProjectDoc; sceneId: string; nodeId: string } {
    const doc = createEmptyProject('Project');
    const sceneId = doc.scenes[0]!.id;
    const node = createWidgetNode('text', 100, 100, { w: 200, h: 100 });
    const scene = addNode(doc.scenes[0]!, node);
    return { doc: { ...doc, scenes: [scene] }, sceneId, nodeId: node.id };
  }

  it('scales positions, sizes, font sizes and stroke widths', () => {
    const { doc, sceneId, nodeId } = docWithNode();
    const styled = updateNodeStyle(doc.scenes[0]!, [nodeId], { fontSize: 32, borderWidth: 4 });
    const withStyle: ProjectDoc = { ...doc, scenes: [styled] };
    const scaled = setSceneSize(withStyle, sceneId, 960, 540, 'scale');
    const node = scaled.scenes[0]!.nodes[nodeId]!;
    expect(scaled.scenes[0]!.width).toBe(960);
    expect(node.x).toBe(50);
    expect(node.w).toBe(100);
    expect(node.style.fontSize).toBe(16);
    expect(node.style.borderWidth).toBe(2);
  });

  it('keeps objects when resizing with keep mode', () => {
    const { doc, sceneId, nodeId } = docWithNode();
    const resized = setSceneSize(doc, sceneId, 1280, 720, 'keep');
    expect(resized.scenes[0]!.nodes[nodeId]!.x).toBe(100);
    expect(resized.scenes[0]!.width).toBe(1280);
  });

  it('refuses to remove the last scene', () => {
    const doc = createEmptyProject('Project');
    expect(() => removeScene(doc, doc.scenes[0]!.id)).toThrow();
  });
});

describe('immutability', () => {
  it('never mutates a frozen input scene', () => {
    const scene = deepFreeze(baseScene());
    const [a, b] = ids(scene);

    const added = addNode(scene, createWidgetNode('shape', 0, 0));
    expect(added.rootIds).toHaveLength(3);

    const grouped = groupNodes(scene, [a, b], 'G');
    expect(grouped.scene.rootIds).toEqual([grouped.groupId]);

    const moved = moveNodes(scene, [a], 5, 5);
    expect(moved.nodes[a]!.x).toBe(105);
    expect(scene.nodes[a]!.x).toBe(100);

    const duplicated = duplicateNodes(scene, [a]);
    expect(duplicated.newIds).toHaveLength(1);

    const reordered = reorder(scene, [a], 'front');
    expect(reordered.rootIds).toEqual([b, a]);
    expect(scene.rootIds).toEqual([a, b]);

    const removed = removeNodes(scene, [a]);
    expect(removed.rootIds).toEqual([b]);

    const aligned = alignNodes(scene, [a, b], 'left', 'canvas');
    expect(aligned.nodes[a]!.x).toBe(0);
    expect(scene.nodes[a]!.x).toBe(100);
  });
});
