import { DocumentError } from './errors';
import { CURRENT_SCHEMA_VERSION, type WidgetInstance } from './model';
import { getWidget } from '../widgets/registry';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateSceneV0(scene: unknown): unknown {
  if (!isRecord(scene)) return scene;
  const rawNodes = scene.nodes;
  if (!Array.isArray(rawNodes)) {
    return { ...scene, nodes: isRecord(rawNodes) ? rawNodes : {} };
  }

  const nodes: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];
  for (const entry of rawNodes) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : undefined;
    if (!id || nodes[id]) continue;
    nodes[id] = {
      ...entry,
      children: [],
      output: isRecord(entry.output) ? entry.output : { padding: 0 },
    };
    order.push(id);
  }

  const rootIds: string[] = [];
  for (const id of order) {
    const node = nodes[id]!;
    const parentId = typeof node.parentId === 'string' && nodes[node.parentId] ? node.parentId : null;
    node.parentId = parentId;
    if (parentId === null) {
      rootIds.push(id);
    } else {
      const parent = nodes[parentId]!;
      const children = Array.isArray(parent.children) ? (parent.children as string[]) : [];
      children.push(id);
      parent.children = children;
    }
  }

  return { ...scene, nodes, rootIds };
}

export function migrateProjectDoc(raw: unknown): unknown {
  if (!isRecord(raw)) {
    throw new DocumentError('This file is not a NeonStage project.');
  }

  const version =
    typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new DocumentError(
      `This project was created by a newer version of NeonStage (schema ${version}). Update NeonStage to open it.`,
      'unsupported-version',
    );
  }

  let doc: Record<string, unknown> = { ...raw };
  if (version < 1) doc = migrateV0ToV1(doc);
  return doc;
}

function migrateV0ToV1(doc: Record<string, unknown>): Record<string, unknown> {
  const scenes = Array.isArray(doc.scenes) ? doc.scenes.map(migrateSceneV0) : doc.scenes;
  return {
    ...doc,
    schemaVersion: 1,
    scenes,
    assets: Array.isArray(doc.assets) ? doc.assets : [],
    settings: isRecord(doc.settings) ? doc.settings : { reduceMotion: false },
  };
}

export function migrateWidget(instance: WidgetInstance): WidgetInstance {
  const definition = getWidget(instance.kind);
  if (!definition) return instance;
  if (instance.version >= definition.version) return instance;
  const migrated = definition.migrate
    ? definition.migrate(instance.props, instance.version)
    : instance.props;
  return { ...instance, version: definition.version, props: definition.validate(migrated) };
}
