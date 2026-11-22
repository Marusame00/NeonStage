import { z } from 'zod';
import { DocumentError } from './errors';
import { CURRENT_SCHEMA_VERSION, defaultStyle, type ProjectDoc, type Scene, type SceneNode } from './model';
import { migrateProjectDoc } from './migrations';
import { getWidget } from '../widgets/registry';

export { DocumentError };

export const MAX_SCENES = 50;
export const MAX_NODES_PER_SCENE = 2000;
export const MAX_STRING_LENGTH = 10_000;
export const MIN_CANVAS_SIZE = 16;
export const MAX_CANVAS_SIZE = 8192;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function numField(def: number, min: number, max: number) {
  return z.unknown().transform((value): number => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  });
}

function boolField(def: boolean) {
  return z.unknown().transform((value): boolean => (typeof value === 'boolean' ? value : def));
}

function strField(def: string, maxLength = MAX_STRING_LENGTH) {
  return z.unknown().transform((value): string => (typeof value === 'string' ? value.slice(0, maxLength) : def));
}

function enumField<T extends string>(values: readonly T[], def: T) {
  return z.unknown().transform((value): T =>
    typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : def,
  );
}

function colorField(def: string) {
  return z.unknown().transform((value): string =>
    typeof value === 'string' && HEX_COLOR.test(value) ? value : def,
  );
}

export const NodeStyleSchema = z.object({
  fontFamily: strField('"Bahnschrift", "Segoe UI", sans-serif', 200),
  fontSize: numField(32, 4, 400),
  fontWeight: numField(600, 100, 900),
  lineHeight: numField(1.2, 0.6, 4),
  letterSpacing: numField(0, -20, 40),
  textAlign: enumField(['left', 'center', 'right'] as const, 'left'),
  textColor: colorField('#ffffff'),
  textOpacity: numField(1, 0, 1),
  bgColor: colorField('#120a24'),
  bgOpacity: numField(0, 0, 1),
  bgGradient: z
    .object({
      enabled: boolField(false),
      color2: colorField('#2a0f4a'),
      angle: numField(135, 0, 360),
    })
    .catch({ enabled: false, color2: '#2a0f4a', angle: 135 }),
  padding: numField(0, 0, 400),
  borderWidth: numField(0, 0, 40),
  borderColor: colorField('#ff3fd2'),
  borderOpacity: numField(1, 0, 1),
  radius: numField(0, 0, 400),
  glowEnabled: boolField(false),
  glowColor: colorField('#ff3fd2'),
  glowSize: numField(8, 0, 40),
  shadowEnabled: boolField(false),
  shadowColor: colorField('#000000'),
  shadowOpacity: numField(0.5, 0, 1),
  shadowX: numField(0, -100, 100),
  shadowY: numField(4, -100, 100),
  shadowBlur: numField(12, 0, 100),
  animate: boolField(true),
  animationSpeed: numField(1, 0.25, 3),
});

export const WidgetInstanceSchema = z.object({
  kind: z.string().min(1).max(64),
  version: numField(1, 0, 1000),
  props: z.record(z.string().max(200), z.unknown()).catch({}),
});

export const SceneNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: enumField(['widget', 'group'] as const, 'widget'),
  name: strField('Node', 200),
  parentId: z.union([z.string().max(64), z.null()]).catch(null),
  children: z.array(z.string().max(64)).max(MAX_NODES_PER_SCENE).catch([]),
  x: numField(0, -100_000, 100_000),
  y: numField(0, -100_000, 100_000),
  w: numField(0, 0, MAX_CANVAS_SIZE),
  h: numField(0, 0, MAX_CANVAS_SIZE),
  visible: boolField(true),
  locked: boolField(false),
  opacity: numField(1, 0, 1),
  style: NodeStyleSchema.catch(defaultStyle()),
  widget: z.union([WidgetInstanceSchema, z.null()]).catch(null),
  output: z.object({ padding: numField(0, 0, 400) }).catch({ padding: 0 }),
});

export const SceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: strField('Scene', 200),
  width: numField(1920, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE),
  height: numField(1080, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE),
  nodes: z.record(z.string().max(64), SceneNodeSchema).catch({}),
  rootIds: z.array(z.string().max(64)).max(MAX_NODES_PER_SCENE).catch([]),
});

export const AssetRefSchema = z.object({
  id: z.string().min(1).max(200),
  name: strField('asset', 200),
  mime: strField('application/octet-stream', 100),
  size: numField(0, 0, Number.MAX_SAFE_INTEGER),
});

export const ProjectDocSchema = z.object({
  schemaVersion: numField(CURRENT_SCHEMA_VERSION, 0, 1000),
  id: z.string().min(1).max(64),
  name: strField('Untitled', 200),
  createdAt: strField('', 64),
  updatedAt: strField('', 64),
  scenes: z.array(SceneSchema).min(1).max(MAX_SCENES),
  assets: z.array(AssetRefSchema).max(500).catch([]),
  settings: z.object({ reduceMotion: boolField(false) }).catch({ reduceMotion: false }),
});

export const ProjectFileSchema = z.object({
  format: z.literal('neonstage-project'),
  fileVersion: z.literal(1),
  draft: ProjectDocSchema,
  live: ProjectDocSchema,
  programSceneId: z.string().max(64),
  liveEdit: boolField(false),
});

export function repairScene(scene: Scene): Scene {
  const nodes: Record<string, SceneNode> = {};
  for (const [key, node] of Object.entries(scene.nodes)) {
    const id = node.id && node.id.length > 0 ? node.id : key;
    nodes[id] = { ...node, id, children: [...node.children] };
  }

  for (const node of Object.values(nodes)) {
    if (node.parentId === null) continue;
    const parent = nodes[node.parentId];
    if (!parent || parent.type !== 'group' || parent.id === node.id) node.parentId = null;
  }

  for (const node of Object.values(nodes)) {
    const seen = new Set<string>([node.id]);
    let current = node.parentId;
    while (current !== null) {
      if (seen.has(current)) {
        node.parentId = null;
        break;
      }
      seen.add(current);
      current = nodes[current]?.parentId ?? null;
    }
  }

  const nextNodes: Record<string, SceneNode> = {};
  for (const node of Object.values(nodes)) nextNodes[node.id] = { ...node, children: [] };

  const claimed = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (node.type !== 'group') continue;
    const kept: string[] = [];
    for (const childId of node.children) {
      const child = nextNodes[childId];
      if (!child || child.parentId !== node.id || claimed.has(childId)) continue;
      claimed.add(childId);
      kept.push(childId);
    }
    nextNodes[node.id]!.children = kept;
  }

  for (const node of Object.values(nextNodes)) {
    if (node.parentId === null || claimed.has(node.id)) continue;
    const parent = nextNodes[node.parentId];
    if (!parent) {
      node.parentId = null;
      continue;
    }
    parent.children.push(node.id);
    claimed.add(node.id);
  }

  const rootIds: string[] = [];
  const rootClaimed = new Set<string>();
  for (const id of scene.rootIds) {
    const node = nextNodes[id];
    if (!node || node.parentId !== null || rootClaimed.has(id)) continue;
    rootClaimed.add(id);
    rootIds.push(id);
  }
  for (const node of Object.values(nextNodes)) {
    if (node.parentId === null && !rootClaimed.has(node.id)) {
      rootClaimed.add(node.id);
      rootIds.push(node.id);
    }
  }

  for (const node of Object.values(nextNodes)) {
    if (!node.widget) continue;
    const definition = getWidget(node.widget.kind);
    if (definition) node.widget = { ...node.widget, props: definition.validate(node.widget.props) };
  }

  return { ...scene, nodes: nextNodes, rootIds };
}

function describeIssues(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'unknown problem';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

export function parseProjectDoc(raw: unknown): ProjectDoc {
  const migrated = migrateProjectDoc(raw);
  const result = ProjectDocSchema.safeParse(migrated);
  if (!result.success) {
    throw new DocumentError(`This file is not a valid NeonStage project (${describeIssues(result.error)}).`);
  }

  for (const scene of result.data.scenes) {
    if (Object.keys(scene.nodes).length > MAX_NODES_PER_SCENE) {
      throw new DocumentError(
        `Scene "${scene.name}" has more than ${MAX_NODES_PER_SCENE} objects and cannot be opened.`,
        'too-large',
      );
    }
  }

  const doc = result.data as unknown as ProjectDoc;
  return { ...doc, scenes: doc.scenes.map(repairScene) };
}
