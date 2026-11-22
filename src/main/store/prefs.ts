import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_PORT } from '../../app-config';
import type { Preferences } from '../../shared/ipc';
import { readJsonWithRecovery, writeFileAtomic } from './atomic';

const EditorPreferencesSchema = z
  .object({
    snap: z.boolean().catch(true),
    gridSize: z.number().min(1).max(500).catch(10),
    showGrid: z.boolean().catch(false),
    showGuides: z.boolean().catch(true),
  })
  .catch({ snap: true, gridSize: 10, showGrid: false, showGuides: true });

const PreferencesSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).catch(DEFAULT_PORT),
    lastProjectId: z.union([z.string().max(64), z.null()]).catch(null),
    editor: EditorPreferencesSchema,
  })
  .catch({
    port: DEFAULT_PORT,
    lastProjectId: null,
    editor: { snap: true, gridSize: 10, showGrid: false, showGuides: true },
  });

export type PreferencesPatch = Partial<Omit<Preferences, 'editor'>> & {
  editor?: Partial<Preferences['editor']>;
};

export function defaultPreferences(): Preferences {
  return {
    port: DEFAULT_PORT,
    lastProjectId: null,
    editor: { snap: true, gridSize: 10, showGrid: false, showGuides: true },
  };
}

export class PrefsStore {
  private prefs: Preferences;
  private readonly notices: string[] = [];
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'preferences.json');
    const loaded = readJsonWithRecovery(this.file, (raw) => PreferencesSchema.parse(raw));
    this.notices.push(...loaded.notices);
    this.prefs = loaded.value ?? defaultPreferences();
  }

  get(): Preferences {
    return {
      port: this.prefs.port,
      lastProjectId: this.prefs.lastProjectId,
      editor: { ...this.prefs.editor },
    };
  }

  update(patch: PreferencesPatch): Preferences {
    const next = PreferencesSchema.parse({
      ...this.prefs,
      ...patch,
      editor: { ...this.prefs.editor, ...(patch.editor ?? {}) },
    });
    this.prefs = next;
    writeFileAtomic(this.file, JSON.stringify(next, null, 2));
    return this.get();
  }

  takeNotices(): string[] {
    return [...this.notices];
  }
}
