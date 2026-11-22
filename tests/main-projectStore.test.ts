import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetStore } from '../src/main/store/assets';
import { buildExport, parseImport, ProjectStore } from '../src/main/store/projectStore';
import { addNode, createWidgetNode } from '../src/shared/ops';
import { containsSecretLikeKeys } from '../src/shared/secrets';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-projects-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ProjectStore', () => {
  it('survives a restart', () => {
    const dir = tempDir();
    const store = new ProjectStore(path.join(dir, 'projects'));
    const created = store.create('Restart test');
    created.file.draft.name = 'Restart test edited';
    store.scheduleSave(created.file.draft.id, created.file);
    store.flush();

    const reopened = new ProjectStore(path.join(dir, 'projects')).load(created.file.draft.id);
    expect(reopened.file).toEqual(created.file);
  });

  it('creates a project from a template', () => {
    const store = new ProjectStore(path.join(tempDir(), 'projects'));
    const created = store.create('Template test', 'synthwave-gameplay');
    expect(created.file.draft.scenes[0]!.rootIds.length).toBeGreaterThan(0);
    expect(created.file.live).toEqual(created.file.draft);
    expect(created.file.programSceneId).toBe(created.file.draft.scenes[0]!.id);
  });

  it('moves deleted projects to the trash folder', () => {
    const dir = tempDir();
    const store = new ProjectStore(path.join(dir, 'projects'));
    const created = store.create('Trash test');

    expect(store.delete(created.file.draft.id)).toBe(true);
    expect(store.list().some((entry) => entry.id === created.file.draft.id)).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'projects', '.trash'))).toHaveLength(1);
  });

  it('exports without secret-like keys', () => {
    const dir = tempDir();
    const store = new ProjectStore(path.join(dir, 'projects'));
    const assets = new AssetStore(path.join(dir, 'assets'));
    const created = store.create('Export test');

    const node = createWidgetNode('text', 0, 0);
    node.widget = {
      ...node.widget!,
      props: { ...node.widget!.props, accessToken: 'x' },
    };
    const scene = addNode(created.file.draft.scenes[0]!, node);
    created.file.draft.scenes = [scene];

    const exported = buildExport(created.file, assets);
    expect(containsSecretLikeKeys(JSON.parse(exported.json))).toBe(false);
    expect(exported.missingAssets).toEqual([]);
  });

  it('assigns a fresh project id on import', () => {
    const dir = tempDir();
    const store = new ProjectStore(path.join(dir, 'projects'));
    const assets = new AssetStore(path.join(dir, 'assets'));
    const created = store.create('Import test');
    const exported = buildExport(created.file, assets);

    const imported = parseImport(exported.json, assets);
    expect(imported.file.draft.id).not.toBe(created.file.draft.id);
    expect(imported.file.draft.scenes[0]!.id).toBe(created.file.draft.scenes[0]!.id);
    expect(imported.file.live).toEqual(imported.file.draft);
  });

  it('skips an imported asset whose hash does not match its id', () => {
    const dir = tempDir();
    const store = new ProjectStore(path.join(dir, 'projects'));
    const assets = new AssetStore(path.join(dir, 'assets'));
    const created = store.create('Asset test');

    const payload = {
      format: 'neonstage-export',
      exportVersion: 1,
      app: 'NeonStage',
      exportedAt: new Date().toISOString(),
      project: created.file.draft,
      assets: [
        {
          id: `${'a'.repeat(64)}.png`,
          name: 'bad.png',
          mime: 'image/png',
          dataBase64: Buffer.from('not the hashed content').toString('base64'),
        },
      ],
    };

    const imported = parseImport(JSON.stringify(payload), assets);
    expect(imported.notices.some((notice) => notice.includes('did not match'))).toBe(true);
    expect(assets.resolve(`${'a'.repeat(64)}.png`)).toBeNull();
  });
});
