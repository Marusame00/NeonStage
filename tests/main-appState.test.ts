import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/main/runtime/appState';
import { ProjectStore } from '../src/main/store/projectStore';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-state-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(): AppState {
  const dir = tempDir();
  const store = new ProjectStore(path.join(dir, 'projects'));
  const created = store.create('State test');
  return new AppState(created.file, { store, runtimeFile: path.join(dir, 'runtime.json') });
}

describe('AppState', () => {
  it('rejects an invalid draft', () => {
    const state = setup();
    expect(state.updateDraft({ nope: true })).toBe(false);
    expect(state.draft.name).toBe('State test');
  });

  it('publishes a copy of the draft', () => {
    const state = setup();
    const next = structuredClone(state.draft);
    next.name = 'Changed';
    expect(state.updateDraft(next)).toBe(true);
    expect(state.live.name).toBe('State test');

    const meta = state.publish();
    expect(meta.liveRev).toBe(1);
    expect(state.live.name).toBe('Changed');
    expect(state.live).not.toBe(state.draft);
    expect(state.live).toEqual(state.draft);
  });

  it('publishes on every accepted draft change when live edit is on', () => {
    const state = setup();
    state.setLiveEdit(true);
    const next = structuredClone(state.draft);
    next.name = 'Live edit';
    expect(state.updateDraft(next)).toBe(true);
    expect(state.live.name).toBe('Live edit');
    expect(state.meta().liveEdit).toBe(true);
  });

  it('publishes the current draft when live edit is turned on', () => {
    const state = setup();
    const next = structuredClone(state.draft);
    next.name = 'Pending draft';
    state.updateDraft(next);
    expect(state.meta().liveDiffers).toBe(true);

    const meta = state.setLiveEdit(true);
    expect(meta.liveEdit).toBe(true);
    expect(meta.liveDiffers).toBe(false);
    expect(meta.liveRev).toBe(1);
    expect(state.live.name).toBe('Pending draft');
  });

  it('toggles liveDiffers', () => {
    const state = setup();
    expect(state.meta().liveDiffers).toBe(false);
    const next = structuredClone(state.draft);
    next.name = 'Differs';
    state.updateDraft(next);
    expect(state.meta().liveDiffers).toBe(true);
    state.publish();
    expect(state.meta().liveDiffers).toBe(false);
  });

  it('rejects an unknown program scene', () => {
    const state = setup();
    expect(() => state.setProgramScene('sc-missing')).toThrow();
  });
});
