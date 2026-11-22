import { expandRect, unionRects, type Rect } from './geometry';
import { getAncestors, getDescendants, getRenderOrder, isEffectivelyVisible } from './ops';
import type { NodeStyle, ProjectDoc, Scene, SceneNode, WidgetInstance } from './model';
import { getWidget } from '../widgets/registry';

export type OutputTarget =
  | { kind: 'live' }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'object'; sceneId: string; nodeId: string }
  | { kind: 'group'; sceneId: string; nodeId: string };

export interface OutputNode {
  id: string;
  parentId: string | null;
  type: 'widget' | 'group';
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  style: NodeStyle | null;
  widget: WidgetInstance | null;
  depth: number;
}

export interface OutputScene {
  sceneId: string;
  width: number;
  height: number;
  viewport: Rect;
  nodes: OutputNode[];
  reduceMotion: boolean;
}

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/i;

export function visualOverflow(node: SceneNode): number {
  const style = node.style;
  const glow = style.glowEnabled ? style.glowSize * 1.5 : 0;
  const shadow = style.shadowEnabled
    ? Math.max(Math.abs(style.shadowX), Math.abs(style.shadowY)) + style.shadowBlur
    : 0;
  let widgetOverflow = 0;
  if (node.widget) {
    const definition = getWidget(node.widget.kind);
    if (definition?.visualOverflow) {
      widgetOverflow = definition.visualOverflow(node.widget.props, style);
    }
  }
  return Math.ceil(Math.max(glow, shadow) + Math.max(0, widgetOverflow));
}

export function effectiveOpacity(scene: Scene, id: string): number {
  const node = scene.nodes[id];
  if (!node) return 0;
  let opacity = node.opacity;
  for (const ancestorId of getAncestors(scene, id)) {
    opacity *= scene.nodes[ancestorId]?.opacity ?? 1;
  }
  return Math.min(1, Math.max(0, opacity));
}

export function resolveTarget(
  doc: ProjectDoc,
  programSceneId: string,
  target: OutputTarget,
): { scene: Scene; rootId: string | null } | null {
  if (target.kind === 'live') {
    const scene = doc.scenes.find((entry) => entry.id === programSceneId) ?? doc.scenes[0];
    return scene ? { scene, rootId: null } : null;
  }

  const scene = doc.scenes.find((entry) => entry.id === target.sceneId);
  if (!scene) return null;
  if (target.kind === 'scene') return { scene, rootId: null };

  const node = scene.nodes[target.nodeId];
  if (!node) return null;
  return { scene, rootId: node.id };
}

function collectNodes(scene: Scene, rootId: string | null, viewport: Rect): OutputNode[] {
  const order = rootId === null ? getRenderOrder(scene) : [rootId, ...getDescendants(scene, rootId)];
  const nodes: OutputNode[] = [];
  for (const id of order) {
    const node = scene.nodes[id];
    if (!node || node.type !== 'widget' || !node.widget) continue;
    if (!isEffectivelyVisible(scene, id)) continue;
    if (!getWidget(node.widget.kind)) continue;
    nodes.push({
      id: node.id,
      parentId: node.parentId,
      type: 'widget',
      x: node.x - viewport.x,
      y: node.y - viewport.y,
      w: node.w,
      h: node.h,
      opacity: effectiveOpacity(scene, id),
      style: node.style,
      widget: node.widget,
      depth: getAncestors(scene, id).length,
    });
  }
  return nodes;
}

// Lenient by design: an 'object' target that points at a group (or a 'group' target that points
// at a widget) still renders whatever subtree the node id resolves to.
export function buildOutputScene(
  doc: ProjectDoc,
  programSceneId: string,
  target: OutputTarget,
): OutputScene | null {
  const resolved = resolveTarget(doc, programSceneId, target);
  if (!resolved) return null;
  const { scene, rootId } = resolved;

  if (rootId === null) {
    const viewport: Rect = { x: 0, y: 0, w: scene.width, h: scene.height };
    return {
      sceneId: scene.id,
      width: scene.width,
      height: scene.height,
      viewport,
      nodes: collectNodes(scene, null, viewport),
      reduceMotion: doc.settings?.reduceMotion === true,
    };
  }

  const root = scene.nodes[rootId]!;
  const widgetIds =
    root.type === 'widget'
      ? [root.id]
      : getDescendants(scene, root.id).filter((id) => scene.nodes[id]?.type === 'widget');
  const visibleWidgetIds = widgetIds.filter((id) => isEffectivelyVisible(scene, id));

  const bounds = unionRects(
    visibleWidgetIds.map((id) => {
      const node = scene.nodes[id]!;
      return expandRect({ x: node.x, y: node.y, w: node.w, h: node.h }, visualOverflow(node));
    }),
  );
  const padding = Math.max(0, root.output.padding);
  const expanded = expandRect(bounds ?? { x: root.x, y: root.y, w: root.w, h: root.h }, padding);
  const left = Math.floor(expanded.x);
  const top = Math.floor(expanded.y);
  const right = Math.ceil(expanded.x + expanded.w);
  const bottom = Math.ceil(expanded.y + expanded.h);
  const viewport: Rect = { x: left, y: top, w: right - left, h: bottom - top };

  const visible = isEffectivelyVisible(scene, rootId);
  return {
    sceneId: scene.id,
    width: scene.width,
    height: scene.height,
    viewport,
    nodes: visible ? collectNodes(scene, rootId, viewport) : [],
    reduceMotion: doc.settings?.reduceMotion === true,
  };
}

export function recommendedSize(outputScene: OutputScene): { width: number; height: number } {
  return { width: outputScene.viewport.w, height: outputScene.viewport.h };
}

function targetSuffix(target: OutputTarget): string {
  switch (target.kind) {
    case 'live':
      return '/live';
    case 'scene':
      return `/scene/${target.sceneId}`;
    case 'object':
      return `/scene/${target.sceneId}/object/${target.nodeId}`;
    case 'group':
      return `/scene/${target.sceneId}/group/${target.nodeId}`;
  }
}

export function outputPaths(target: OutputTarget): { outputPath: string; eventsPath: string } {
  const suffix = targetSuffix(target);
  return { outputPath: `/output${suffix}`, eventsPath: `/events${suffix}` };
}

export function parseOutputPath(
  pathname: string,
  prefix: 'output' | 'events' = 'output',
): OutputTarget | null {
  const clean = pathname.split('?')[0]!.split('#')[0]!;
  const base = `/${prefix}/`;
  if (!clean.startsWith(base)) return null;
  const rest = clean.slice(base.length).replace(/\/+$/, '');
  if (rest.length === 0) return null;
  const parts = rest.split('/');
  const isId = (value: string | undefined): value is string =>
    value !== undefined && ID_PATTERN.test(value);

  if (parts.length === 1 && parts[0] === 'live') return { kind: 'live' };
  if (parts.length === 2 && parts[0] === 'scene' && isId(parts[1])) {
    return { kind: 'scene', sceneId: parts[1] };
  }
  if (parts.length === 4 && parts[0] === 'scene' && isId(parts[1]) && isId(parts[3])) {
    const kind = parts[2];
    if (kind === 'object' || kind === 'group') {
      return { kind, sceneId: parts[1], nodeId: parts[3] };
    }
  }
  return null;
}
