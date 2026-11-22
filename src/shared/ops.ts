import { newId } from './ids';
import { unionRects, type Rect } from './geometry';
import { defaultStyle, type NodeStyle, type ProjectDoc, type Scene, type SceneNode } from './model';
import { getWidget } from '../widgets/registry';

export type WidgetNodeOverrides = Partial<
  Omit<SceneNode, 'type' | 'children' | 'style' | 'widget'>
> & {
  style?: Partial<NodeStyle>;
  props?: Record<string, unknown>;
};

export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type AlignReference = 'selection' | 'canvas';
export type SceneSizeMode = 'keep' | 'scale';

const widgetNameCounters: Record<string, number> = {};

function rectOf(node: SceneNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

function cloneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    children: [...node.children],
    style: { ...node.style, bgGradient: { ...node.style.bgGradient } },
    widget: node.widget ? { ...node.widget, props: { ...node.widget.props } } : null,
    output: { ...node.output },
  };
}

function withNodes(scene: Scene, updates: Record<string, SceneNode>): Scene {
  return { ...scene, nodes: { ...scene.nodes, ...updates } };
}

function parentList(scene: Scene, parentId: string | null): string[] {
  if (parentId === null) return scene.rootIds;
  return scene.nodes[parentId]?.children ?? [];
}

function setParentList(scene: Scene, parentId: string | null, list: string[]): Scene {
  if (parentId === null) return { ...scene, rootIds: list };
  const parent = scene.nodes[parentId];
  if (!parent) return scene;
  return withNodes(scene, { [parentId]: { ...parent, children: list } });
}

export function getDescendants(scene: Scene, id: string): string[] {
  const out: string[] = [];
  const walk = (nodeId: string): void => {
    const node = scene.nodes[nodeId];
    if (!node) return;
    for (const childId of node.children) {
      if (!scene.nodes[childId]) continue;
      out.push(childId);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

export function getAncestors(scene: Scene, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = scene.nodes[id]?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    const parent = scene.nodes[current];
    if (!parent) break;
    out.push(current);
    seen.add(current);
    current = parent.parentId;
  }
  return out;
}

export function getRenderOrder(scene: Scene): string[] {
  const out: string[] = [];
  const walk = (ids: string[]): void => {
    for (const id of ids) {
      const node = scene.nodes[id];
      if (!node) continue;
      out.push(id);
      if (node.type === 'group') walk(node.children);
    }
  };
  walk(scene.rootIds);
  return out;
}

export function isEffectivelyVisible(scene: Scene, id: string): boolean {
  const node = scene.nodes[id];
  if (!node || !node.visible) return false;
  return getAncestors(scene, id).every((ancestorId) => scene.nodes[ancestorId]?.visible === true);
}

export function isEffectivelyLocked(scene: Scene, id: string): boolean {
  const node = scene.nodes[id];
  if (!node) return false;
  if (node.locked) return true;
  return getAncestors(scene, id).some((ancestorId) => scene.nodes[ancestorId]?.locked === true);
}

export function recomputeGroupBounds(scene: Scene, groupId: string): Scene {
  const group = scene.nodes[groupId];
  if (!group || group.type !== 'group') return scene;
  const bounds = unionRects(
    group.children
      .map((childId) => scene.nodes[childId])
      .filter((child): child is SceneNode => child !== undefined)
      .map(rectOf),
  );
  if (!bounds) return scene;
  if (group.x === bounds.x && group.y === bounds.y && group.w === bounds.w && group.h === bounds.h) {
    return scene;
  }
  const next = withNodes(scene, { [groupId]: { ...group, ...bounds } });
  return group.parentId ? recomputeGroupBounds(next, group.parentId) : next;
}

function translateSubtree(scene: Scene, id: string, dx: number, dy: number): Scene {
  const node = scene.nodes[id];
  if (!node || (dx === 0 && dy === 0)) return scene;
  const updates: Record<string, SceneNode> = {};
  for (const nodeId of [id, ...getDescendants(scene, id)]) {
    const current = scene.nodes[nodeId];
    if (!current) continue;
    updates[nodeId] = { ...current, x: current.x + dx, y: current.y + dy };
  }
  let next = withNodes(scene, updates);
  for (const ancestorId of getAncestors(scene, id)) next = recomputeGroupBounds(next, ancestorId);
  return next;
}

export function addNode(
  scene: Scene,
  node: SceneNode,
  parentId: string | null = null,
  index?: number,
): Scene {
  if (parentId !== null) {
    const parent = scene.nodes[parentId];
    if (!parent || parent.type !== 'group') {
      throw new Error(`Cannot add a node to missing group "${parentId}"`);
    }
  }
  const placed: SceneNode = { ...cloneNode(node), parentId };
  let next = withNodes(scene, { [placed.id]: placed });
  const list = [...parentList(next, parentId)];
  const at = index === undefined ? list.length : Math.max(0, Math.min(list.length, index));
  list.splice(at, 0, placed.id);
  next = setParentList(next, parentId, list);
  return parentId === null ? next : recomputeGroupBounds(next, parentId);
}

export function createWidgetNode(
  kind: string,
  x: number,
  y: number,
  overrides: WidgetNodeOverrides = {},
): SceneNode {
  const definition = getWidget(kind);
  if (!definition) throw new Error(`Unknown widget kind "${kind}"`);

  const counter = (widgetNameCounters[kind] ?? 0) + 1;
  widgetNameCounters[kind] = counter;

  const style: NodeStyle = {
    ...defaultStyle(),
    ...(definition.defaultStyle ? definition.defaultStyle() : {}),
    ...(overrides.style ?? {}),
  };
  const props = definition.validate({ ...definition.defaultProps(), ...(overrides.props ?? {}) });

  return {
    id: overrides.id ?? newId('nd'),
    type: 'widget',
    name: overrides.name ?? `${definition.name} ${counter}`,
    parentId: overrides.parentId ?? null,
    children: [],
    x,
    y,
    w: overrides.w ?? definition.defaultSize.w,
    h: overrides.h ?? definition.defaultSize.h,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    opacity: overrides.opacity ?? 1,
    style,
    widget: { kind, version: definition.version, props },
    output: overrides.output ?? { padding: 0 },
  };
}

export function removeNodes(scene: Scene, ids: string[]): Scene {
  const toRemove = new Set<string>();
  for (const id of ids) {
    if (!scene.nodes[id]) continue;
    toRemove.add(id);
    for (const descendantId of getDescendants(scene, id)) toRemove.add(descendantId);
  }
  if (toRemove.size === 0) return scene;

  const affected = new Set<string>();
  for (const id of toRemove) {
    const parentId = scene.nodes[id]?.parentId ?? null;
    if (parentId) affected.add(parentId);
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const groupId of [...affected]) {
      if (toRemove.has(groupId)) continue;
      const group = scene.nodes[groupId];
      if (!group || group.type !== 'group') continue;
      if (group.children.every((childId) => toRemove.has(childId))) {
        toRemove.add(groupId);
        if (group.parentId) affected.add(group.parentId);
        grew = true;
      }
    }
  }

  const nodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(scene.nodes)) {
    if (toRemove.has(id)) continue;
    nodes[id] = node.children.some((childId) => toRemove.has(childId))
      ? { ...node, children: node.children.filter((childId) => !toRemove.has(childId)) }
      : node;
  }

  let next: Scene = {
    ...scene,
    nodes,
    rootIds: scene.rootIds.filter((id) => !toRemove.has(id)),
  };
  for (const parentId of affected) {
    if (next.nodes[parentId]) next = recomputeGroupBounds(next, parentId);
  }
  return next;
}

export function updateNode(scene: Scene, id: string, patch: Partial<SceneNode>): Scene {
  const node = scene.nodes[id];
  if (!node) return scene;
  const { id: _id, type: _type, children: _children, parentId: _parentId, widget: _widget, ...rest } = patch;
  return withNodes(scene, { [id]: { ...node, ...rest } });
}

export function updateNodeStyle(scene: Scene, ids: string[], patch: Partial<NodeStyle>): Scene {
  const updates: Record<string, SceneNode> = {};
  for (const id of ids) {
    const node = scene.nodes[id];
    if (!node) continue;
    updates[id] = {
      ...node,
      style: {
        ...node.style,
        ...patch,
        bgGradient: { ...node.style.bgGradient, ...(patch.bgGradient ?? {}) },
      },
    };
  }
  return Object.keys(updates).length > 0 ? withNodes(scene, updates) : scene;
}

export function updateWidgetProps(scene: Scene, id: string, patch: Record<string, unknown>): Scene {
  const node = scene.nodes[id];
  if (!node || !node.widget) return scene;
  const definition = getWidget(node.widget.kind);
  const merged = { ...node.widget.props, ...patch };
  const props = definition ? definition.validate(merged) : merged;
  return withNodes(scene, { [id]: { ...node, widget: { ...node.widget, props } } });
}

export function moveNodes(scene: Scene, ids: string[], dx: number, dy: number): Scene {
  const moving = new Set<string>();
  for (const id of ids) {
    if (!scene.nodes[id] || isEffectivelyLocked(scene, id)) continue;
    moving.add(id);
    for (const descendantId of getDescendants(scene, id)) moving.add(descendantId);
  }
  if (moving.size === 0) return scene;

  const updates: Record<string, SceneNode> = {};
  for (const id of moving) {
    const node = scene.nodes[id];
    if (!node) continue;
    updates[id] = { ...node, x: node.x + dx, y: node.y + dy };
  }
  let next = withNodes(scene, updates);

  const ancestors = new Set<string>();
  for (const id of moving) for (const ancestorId of getAncestors(scene, id)) ancestors.add(ancestorId);
  for (const ancestorId of ancestors) next = recomputeGroupBounds(next, ancestorId);
  return next;
}

// Reparents a node without moving it on the canvas. `index` is the insertion position in the
// destination list once the node has been taken out of it.
export function moveNodeTo(
  scene: Scene,
  id: string,
  newParentId: string | null,
  index: number,
): Scene {
  const node = scene.nodes[id];
  if (!node) return scene;
  if (newParentId !== null) {
    const parent = scene.nodes[newParentId];
    if (!parent || parent.type !== 'group') return scene;
    if (newParentId === id || getDescendants(scene, id).includes(newParentId)) return scene;
  }

  const oldParentId = node.parentId;
  const oldParentEmpties =
    oldParentId !== null &&
    newParentId !== oldParentId &&
    (scene.nodes[oldParentId]?.children ?? []).filter((entry) => entry !== id).length === 0;

  let oldList = parentList(scene, oldParentId).filter((entry) => entry !== id);
  if (oldParentEmpties && oldParentId !== null) {
    oldList = oldList.filter((entry) => entry !== oldParentId);
  }
  let next = setParentList(scene, oldParentId, oldList);
  const moved = next.nodes[id];
  if (!moved) return scene;
  next = withNodes(next, { [id]: { ...moved, parentId: newParentId } });
  if (oldParentEmpties && oldParentId !== null) next = removeNodes(next, [oldParentId]);

  const newList = [...parentList(next, newParentId)];
  const at = Math.max(0, Math.min(newList.length, Math.round(index)));
  newList.splice(at, 0, id);
  next = setParentList(next, newParentId, newList);

  if (newParentId) next = recomputeGroupBounds(next, newParentId);
  if (oldParentId && next.nodes[oldParentId]) next = recomputeGroupBounds(next, oldParentId);
  return next;
}

// Resizing a group rescales its arrangement: every descendant's position and size is scaled
// relative to the group box, so the internal composition is preserved.
export function setNodeRect(scene: Scene, id: string, rect: Rect): Scene {
  const node = scene.nodes[id];
  if (!node) return scene;

  if (node.type === 'widget') {
    const definition = node.widget ? getWidget(node.widget.kind) : undefined;
    const minW = Math.max(4, definition?.minSize?.w ?? 4);
    const minH = Math.max(4, definition?.minSize?.h ?? 4);
    let next = withNodes(scene, {
      [id]: { ...node, x: rect.x, y: rect.y, w: Math.max(minW, rect.w), h: Math.max(minH, rect.h) },
    });
    for (const ancestorId of getAncestors(scene, id)) next = recomputeGroupBounds(next, ancestorId);
    return next;
  }

  const sx = node.w === 0 ? 1 : rect.w / node.w;
  const sy = node.h === 0 ? 1 : rect.h / node.h;
  const updates: Record<string, SceneNode> = {};
  for (const descendantId of getDescendants(scene, id)) {
    const child = scene.nodes[descendantId];
    if (!child) continue;
    updates[descendantId] = {
      ...child,
      x: rect.x + (child.x - node.x) * sx,
      y: rect.y + (child.y - node.y) * sy,
      w: child.w * sx,
      h: child.h * sy,
    };
  }
  updates[id] = { ...node, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  let next = recomputeGroupBounds(withNodes(scene, updates), id);
  for (const ancestorId of getAncestors(scene, id)) next = recomputeGroupBounds(next, ancestorId);
  return next;
}

export function reorder(scene: Scene, ids: string[], direction: ReorderDirection): Scene {
  const moving = new Set(ids.filter((id) => scene.nodes[id]));
  if (moving.size === 0) return scene;

  const parents = new Set<string | null>();
  for (const id of moving) parents.add(scene.nodes[id]?.parentId ?? null);

  let next = scene;
  for (const parentId of parents) {
    const list = [...parentList(next, parentId)];
    const indices = list.map((id, index) => (moving.has(id) ? index : -1)).filter((index) => index >= 0);
    if (indices.length === 0) continue;

    let reordered: string[];
    if (direction === 'front' || direction === 'back') {
      const rest = list.filter((id) => !moving.has(id));
      const moved = list.filter((id) => moving.has(id));
      reordered = direction === 'front' ? [...rest, ...moved] : [...moved, ...rest];
    } else if (direction === 'forward') {
      reordered = [...list];
      for (let i = indices.length - 1; i >= 0; i -= 1) {
        const index = indices[i]!;
        const above = reordered[index + 1];
        if (above !== undefined && !moving.has(above)) {
          reordered[index + 1] = reordered[index]!;
          reordered[index] = above;
        }
      }
    } else {
      reordered = [...list];
      for (const index of indices) {
        const below = reordered[index - 1];
        if (below !== undefined && !moving.has(below)) {
          reordered[index - 1] = reordered[index]!;
          reordered[index] = below;
        }
      }
    }
    next = setParentList(next, parentId, reordered);
  }
  return next;
}

export function duplicateNodes(
  scene: Scene,
  ids: string[],
  offset = 24,
): { scene: Scene; newIds: string[] } {
  const unique = ids.filter((id, index) => scene.nodes[id] && ids.indexOf(id) === index);
  const roots = unique.filter((id) => !getAncestors(scene, id).some((ancestorId) => unique.includes(ancestorId)));
  if (roots.length === 0) return { scene, newIds: [] };

  const created: Record<string, SceneNode> = {};
  const newIds: string[] = [];

  for (const rootId of roots) {
    const subtree = [rootId, ...getDescendants(scene, rootId)];
    const idMap = new Map<string, string>();
    for (const id of subtree) idMap.set(id, newId('nd'));

    for (const id of subtree) {
      const source = scene.nodes[id];
      if (!source) continue;
      const copy = cloneNode(source);
      copy.id = idMap.get(id)!;
      copy.parentId =
        source.parentId !== null && idMap.has(source.parentId)
          ? idMap.get(source.parentId)!
          : source.parentId;
      copy.children = source.children.map((childId) => idMap.get(childId) ?? childId);
      copy.x = source.x + offset;
      copy.y = source.y + offset;
      created[copy.id] = copy;
    }
    newIds.push(idMap.get(rootId)!);
  }

  let next = withNodes(scene, created);
  const parents = new Set<string | null>();
  for (const rootId of roots) {
    const original = scene.nodes[rootId];
    if (!original) continue;
    parents.add(original.parentId);
    const list = [...parentList(next, original.parentId)];
    const index = list.indexOf(rootId);
    list.splice(index >= 0 ? index + 1 : list.length, 0, newIds[roots.indexOf(rootId)]!);
    next = setParentList(next, original.parentId, list);
  }
  for (const parentId of parents) {
    if (parentId) next = recomputeGroupBounds(next, parentId);
  }
  return { scene: next, newIds };
}

export function groupNodes(
  scene: Scene,
  ids: string[],
  name = 'Group',
): { scene: Scene; groupId: string } {
  const members = ids.filter((id, index) => scene.nodes[id] && ids.indexOf(id) === index);
  if (members.length === 0) throw new Error('groupNodes requires at least one node');
  const parentId = scene.nodes[members[0]!]?.parentId ?? null;
  if (members.some((id) => (scene.nodes[id]?.parentId ?? null) !== parentId)) {
    throw new Error('groupNodes requires nodes that share a parent');
  }

  const list = [...parentList(scene, parentId)];
  const memberSet = new Set(members);
  const ordered = list.filter((id) => memberSet.has(id));
  const bounds = unionRects(
    ordered.map((id) => scene.nodes[id]).filter((node): node is SceneNode => node !== undefined).map(rectOf),
  ) ?? { x: 0, y: 0, w: 0, h: 0 };

  const groupId = newId('gr');
  const group: SceneNode = {
    id: groupId,
    type: 'group',
    name,
    parentId,
    children: ordered,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    visible: true,
    locked: false,
    opacity: 1,
    style: defaultStyle(),
    widget: null,
    output: { padding: 0 },
  };

  const updates: Record<string, SceneNode> = { [groupId]: group };
  for (const id of ordered) {
    const node = scene.nodes[id];
    if (node) updates[id] = { ...node, parentId: groupId };
  }
  let next = withNodes(scene, updates);

  const lastMember = ordered[ordered.length - 1];
  const newList: string[] = [];
  for (const id of list) {
    if (memberSet.has(id)) {
      if (id === lastMember) newList.push(groupId);
    } else {
      newList.push(id);
    }
  }
  next = setParentList(next, parentId, newList);
  return { scene: parentId ? recomputeGroupBounds(next, parentId) : next, groupId };
}

export function ungroup(scene: Scene, groupId: string): { scene: Scene; childIds: string[] } {
  const group = scene.nodes[groupId];
  if (!group || group.type !== 'group') return { scene, childIds: [] };

  const childIds = [...group.children];
  const parentId = group.parentId;
  const list = [...parentList(scene, parentId)];
  const index = list.indexOf(groupId);

  const updates: Record<string, SceneNode> = {};
  for (const childId of childIds) {
    const child = scene.nodes[childId];
    if (child) updates[childId] = { ...child, parentId };
  }
  let next = withNodes(scene, updates);

  const nodes = { ...next.nodes };
  delete nodes[groupId];
  next = { ...next, nodes };

  const newList = list.filter((id) => id !== groupId);
  newList.splice(index >= 0 ? index : newList.length, 0, ...childIds);
  next = setParentList(next, parentId, newList);
  return { scene: parentId ? recomputeGroupBounds(next, parentId) : next, childIds };
}

export function setVisible(scene: Scene, ids: string[], visible: boolean): Scene {
  const updates: Record<string, SceneNode> = {};
  for (const id of ids) {
    const node = scene.nodes[id];
    if (node) updates[id] = { ...node, visible };
  }
  return Object.keys(updates).length > 0 ? withNodes(scene, updates) : scene;
}

export function setLocked(scene: Scene, ids: string[], locked: boolean): Scene {
  const updates: Record<string, SceneNode> = {};
  for (const id of ids) {
    const node = scene.nodes[id];
    if (node) updates[id] = { ...node, locked };
  }
  return Object.keys(updates).length > 0 ? withNodes(scene, updates) : scene;
}

export function alignNodes(
  scene: Scene,
  ids: string[],
  mode: AlignMode,
  relativeTo: AlignReference = 'selection',
): Scene {
  const targets = ids.filter((id, index) => scene.nodes[id] && ids.indexOf(id) === index);
  if (targets.length === 0) return scene;

  const reference =
    relativeTo === 'canvas'
      ? { x: 0, y: 0, w: scene.width, h: scene.height }
      : unionRects(
          targets
            .map((id) => scene.nodes[id])
            .filter((node): node is SceneNode => node !== undefined)
            .map(rectOf),
        );
  if (!reference) return scene;

  let next = scene;
  for (const id of targets) {
    const node = next.nodes[id];
    if (!node) continue;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = reference.x - node.x;
        break;
      case 'hcenter':
        dx = reference.x + reference.w / 2 - (node.x + node.w / 2);
        break;
      case 'right':
        dx = reference.x + reference.w - (node.x + node.w);
        break;
      case 'top':
        dy = reference.y - node.y;
        break;
      case 'vcenter':
        dy = reference.y + reference.h / 2 - (node.y + node.h / 2);
        break;
      case 'bottom':
        dy = reference.y + reference.h - (node.y + node.h);
        break;
    }
    next = translateSubtree(next, id, dx, dy);
  }
  return next;
}

export function distributeNodes(scene: Scene, ids: string[], axis: 'h' | 'v'): Scene {
  const targets = ids.filter((id, index) => scene.nodes[id] && ids.indexOf(id) === index);
  if (targets.length < 3) return scene;

  const positionKey = axis === 'h' ? 'x' : 'y';
  const sizeKey = axis === 'h' ? 'w' : 'h';
  const sorted = [...targets].sort(
    (a, b) => (scene.nodes[a]?.[positionKey] ?? 0) - (scene.nodes[b]?.[positionKey] ?? 0),
  );

  const first = scene.nodes[sorted[0]!]!;
  const last = scene.nodes[sorted[sorted.length - 1]!]!;
  const span = last[positionKey] + last[sizeKey] - first[positionKey];
  const totalSize = sorted.reduce((sum, id) => sum + (scene.nodes[id]?.[sizeKey] ?? 0), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  let next = scene;
  let cursor = first[positionKey];
  for (const id of sorted) {
    const node = next.nodes[id];
    if (!node) continue;
    const delta = cursor - node[positionKey];
    next = translateSubtree(next, id, axis === 'h' ? delta : 0, axis === 'h' ? 0 : delta);
    cursor += node[sizeKey] + gap;
  }
  return next;
}

export function addScene(doc: ProjectDoc, scene: Scene): ProjectDoc {
  return { ...doc, scenes: [...doc.scenes, scene], updatedAt: new Date().toISOString() };
}

export function renameScene(doc: ProjectDoc, id: string, name: string): ProjectDoc {
  if (!doc.scenes.some((scene) => scene.id === id)) return doc;
  return {
    ...doc,
    scenes: doc.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
    updatedAt: new Date().toISOString(),
  };
}

export function duplicateScene(doc: ProjectDoc, id: string): ProjectDoc {
  const index = doc.scenes.findIndex((scene) => scene.id === id);
  if (index < 0) return doc;
  const source = doc.scenes[index]!;

  const idMap = new Map<string, string>();
  for (const nodeId of Object.keys(source.nodes)) idMap.set(nodeId, newId('nd'));

  const nodes: Record<string, SceneNode> = {};
  for (const [nodeId, node] of Object.entries(source.nodes)) {
    const copy = cloneNode(node);
    copy.id = idMap.get(nodeId)!;
    copy.parentId = node.parentId !== null ? idMap.get(node.parentId) ?? null : null;
    copy.children = node.children.map((childId) => idMap.get(childId) ?? childId);
    nodes[copy.id] = copy;
  }

  const copyScene: Scene = {
    ...source,
    id: newId('sc'),
    name: `${source.name} copy`,
    nodes,
    rootIds: source.rootIds.map((nodeId) => idMap.get(nodeId) ?? nodeId),
  };

  const scenes = [...doc.scenes];
  scenes.splice(index + 1, 0, copyScene);
  return { ...doc, scenes, updatedAt: new Date().toISOString() };
}

export function removeScene(doc: ProjectDoc, id: string): ProjectDoc {
  if (doc.scenes.length <= 1) throw new Error('Cannot remove the last scene');
  if (!doc.scenes.some((scene) => scene.id === id)) return doc;
  return {
    ...doc,
    scenes: doc.scenes.filter((scene) => scene.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

// Composition scaling: 'scale' multiplies positions, sizes, font sizes and stroke widths by
// min(sx, sy) so the arrangement keeps its proportions.
export function setSceneSize(
  doc: ProjectDoc,
  id: string,
  width: number,
  height: number,
  mode: SceneSizeMode,
): ProjectDoc {
  const scene = doc.scenes.find((entry) => entry.id === id);
  if (!scene) return doc;

  let nextScene: Scene = { ...scene, width, height };
  if (mode === 'scale') {
    const sx = scene.width === 0 ? 1 : width / scene.width;
    const sy = scene.height === 0 ? 1 : height / scene.height;
    const factor = Math.min(sx, sy);
    const nodes: Record<string, SceneNode> = {};
    for (const [nodeId, node] of Object.entries(scene.nodes)) {
      nodes[nodeId] = {
        ...node,
        x: node.x * factor,
        y: node.y * factor,
        w: node.w * factor,
        h: node.h * factor,
        style: {
          ...node.style,
          fontSize: node.style.fontSize * factor,
          borderWidth: node.style.borderWidth * factor,
        },
      };
    }
    nextScene = { ...nextScene, nodes };
  }

  return {
    ...doc,
    scenes: doc.scenes.map((entry) => (entry.id === id ? nextScene : entry)),
    updatedAt: new Date().toISOString(),
  };
}
