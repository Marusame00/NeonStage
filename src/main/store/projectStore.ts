import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { APP_NAME, PROJECT_FILE_EXT } from '../../app-config';
import { newId } from '../../shared/ids';
import { createEmptyProject, type ProjectDoc, type ProjectFile } from '../../shared/model';
import { DocumentError, parseProjectDoc, ProjectFileSchema } from '../../shared/schema';
import { stripSecrets } from '../../shared/secrets';
import { TEMPLATES } from '../../shared/templates';
import type { ProjectSummary } from '../../shared/ipc';
import { isAssetId, type AssetStore } from './assets';
import { readJsonWithRecovery, writeFileAtomic } from './atomic';

const PROJECT_ID = /^[a-z0-9_-]{1,64}$/i;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export type SaveState = 'saved' | 'saving' | 'error';

export interface ProjectStoreOptions {
  onSaveState?: (id: string, state: SaveState, error?: string) => void;
  debounceMs?: number;
}

const ExportAssetSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(200),
  mime: z.string().max(100),
  dataBase64: z.string(),
});

const ExportFileSchema = z.object({
  format: z.literal('neonstage-export'),
  exportVersion: z.literal(1),
  app: z.string().max(100),
  exportedAt: z.string().max(64),
  project: z.unknown(),
  assets: z.array(ExportAssetSchema).max(500).catch([]),
});

function parseProjectFile(raw: unknown): ProjectFile {
  const result = ProjectFileSchema.safeParse(raw);
  if (!result.success) throw new DocumentError('This project file is not valid.');
  const draft = parseProjectDoc(result.data.draft);
  const live = parseProjectDoc(result.data.live);
  const programSceneId = draft.scenes.some((scene) => scene.id === result.data.programSceneId)
    ? result.data.programSceneId
    : draft.scenes[0]!.id;
  return {
    format: 'neonstage-project',
    fileVersion: 1,
    draft,
    live,
    programSceneId,
    liveEdit: result.data.liveEdit,
  };
}

export class ProjectStore {
  onSaveState?: (id: string, state: SaveState, error?: string) => void;
  private readonly pending = new Map<string, { file: ProjectFile; timer: NodeJS.Timeout }>();
  private readonly debounceMs: number;

  constructor(
    private readonly dir: string,
    options: ProjectStoreOptions = {},
  ) {
    this.onSaveState = options.onSaveState;
    this.debounceMs = options.debounceMs ?? 400;
    fs.mkdirSync(dir, { recursive: true });
  }

  list(): ProjectSummary[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(PROJECT_FILE_EXT) || entry.startsWith('.')) continue;
      const id = entry.slice(0, -PROJECT_FILE_EXT.length);
      if (!PROJECT_ID.test(id)) continue;
      const full = path.join(this.dir, entry);
      let name = id;
      let updatedAt = 0;
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as {
          draft?: { name?: unknown; updatedAt?: unknown };
        };
        if (typeof raw.draft?.name === 'string') name = raw.draft.name;
        if (typeof raw.draft?.updatedAt === 'string') updatedAt = Date.parse(raw.draft.updatedAt) || 0;
      } catch {
        updatedAt = 0;
      }
      if (!updatedAt) {
        try {
          updatedAt = fs.statSync(full).mtimeMs;
        } catch {
          updatedAt = 0;
        }
      }
      out.push({ id, name, updatedAt });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  load(id: string): { file: ProjectFile; notices: string[] } {
    const result = readJsonWithRecovery(this.filePath(id), parseProjectFile);
    if (!result.value) throw new DocumentError(`Project "${id}" could not be opened.`);
    return { file: result.value, notices: result.notices };
  }

  create(name: string, templateId?: string): { file: ProjectFile; notices: string[] } {
    const draft = createEmptyProject(name);
    const template = templateId ? TEMPLATES.find((entry) => entry.id === templateId) : undefined;
    if (template) {
      const first = draft.scenes[0]!;
      draft.scenes = [template.build(first.width, first.height)];
    }
    const live = structuredClone(draft);
    const file: ProjectFile = {
      format: 'neonstage-project',
      fileVersion: 1,
      draft,
      live,
      programSceneId: draft.scenes[0]!.id,
      liveEdit: false,
    };
    this.save(file);
    return { file, notices: [] };
  }

  save(file: ProjectFile): void {
    const id = file.draft.id;
    this.cancelPending(id);
    try {
      writeFileAtomic(this.filePath(id), JSON.stringify(file, null, 2));
      this.onSaveState?.(id, 'saved');
    } catch (error) {
      this.onSaveState?.(id, 'error', error instanceof Error ? error.message : 'Could not save.');
      throw error;
    }
  }

  scheduleSave(id: string, file: ProjectFile): void {
    this.cancelPending(id);
    this.onSaveState?.(id, 'saving');
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.writeNow(id, file);
    }, this.debounceMs);
    timer.unref();
    this.pending.set(id, { file, timer });
  }

  flush(): void {
    for (const [id, entry] of [...this.pending]) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      this.writeNow(id, entry.file);
    }
  }

  rename(id: string, name: string): ProjectFile {
    const { file } = this.load(id);
    const now = new Date().toISOString();
    const next: ProjectFile = {
      ...file,
      draft: { ...file.draft, name, updatedAt: now },
      live: { ...file.live, name, updatedAt: now },
    };
    this.save(next);
    return next;
  }

  delete(id: string): boolean {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return false;
    this.cancelPending(id);
    const trash = path.join(this.dir, '.trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(file, path.join(trash, `${Date.now()}-${id}${PROJECT_FILE_EXT}`));
    return true;
  }

  private writeNow(id: string, file: ProjectFile): void {
    try {
      writeFileAtomic(this.filePath(id), JSON.stringify(file, null, 2));
      this.onSaveState?.(id, 'saved');
    } catch (error) {
      this.onSaveState?.(id, 'error', error instanceof Error ? error.message : 'Could not save.');
    }
  }

  private cancelPending(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
  }

  private filePath(id: string): string {
    if (!PROJECT_ID.test(id)) throw new DocumentError('That project id is not valid.');
    return path.join(this.dir, `${id}${PROJECT_FILE_EXT}`);
  }
}

export function buildExport(
  file: ProjectFile,
  assets: AssetStore,
): { json: string; missingAssets: string[] } {
  const missingAssets: string[] = [];
  const embedded: { id: string; name: string; mime: string; dataBase64: string }[] = [];
  for (const ref of file.draft.assets) {
    const data = assets.readBase64(ref.id);
    if (!data) {
      missingAssets.push(ref.id);
      continue;
    }
    embedded.push({ id: ref.id, name: ref.name, mime: ref.mime, dataBase64: data });
  }
  const payload = {
    format: 'neonstage-export' as const,
    exportVersion: 1 as const,
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    project: stripSecrets(file.draft),
    assets: embedded,
  };
  return { json: JSON.stringify(payload, null, 2), missingAssets };
}

export function parseImport(
  raw: unknown,
  assets: AssetStore,
): { file: ProjectFile; notices: string[] } {
  if (typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') > MAX_IMPORT_BYTES) {
    throw new DocumentError('This file is larger than 100 MB and cannot be imported.', 'too-large');
  }
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DocumentError('This file is not a NeonStage export.');
    }
  }
  const result = ExportFileSchema.safeParse(parsed);
  if (!result.success) throw new DocumentError('This file is not a NeonStage export.');

  const draft = parseProjectDoc(result.data.project);
  const notices: string[] = [];
  const written = new Set<string>();

  for (const asset of result.data.assets) {
    if (!isAssetId(asset.id)) {
      notices.push(`Asset "${asset.name}" was skipped because its id is not valid.`);
      continue;
    }
    const expected = asset.id.slice(0, asset.id.lastIndexOf('.'));
    const buffer = Buffer.from(asset.dataBase64, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (hash !== expected) {
      notices.push(`Asset "${asset.name}" was skipped because its contents did not match its id.`);
      continue;
    }
    if (assets.writeFromBase64(asset.id, asset.name, asset.mime, asset.dataBase64)) {
      written.add(asset.id);
    } else {
      notices.push(`Asset "${asset.name}" could not be imported.`);
    }
  }

  const now = new Date().toISOString();
  const project: ProjectDoc = { ...draft, id: newId('prj'), updatedAt: now };
  for (const ref of project.assets) {
    if (!written.has(ref.id)) notices.push(`Asset "${ref.name}" is missing from this export.`);
  }

  const live = structuredClone(project);
  const file: ProjectFile = {
    format: 'neonstage-project',
    fileVersion: 1,
    draft: project,
    live,
    programSceneId: project.scenes[0]!.id,
    liveEdit: false,
  };
  return { file, notices };
}
