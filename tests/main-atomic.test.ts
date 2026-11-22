import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonWithRecovery, writeFileAtomic } from '../src/main/store/atomic';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-atomic-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('keeps the previous contents as a backup', () => {
    const file = path.join(tempDir(), 'data.json');
    writeFileAtomic(file, '{"v":1}');
    writeFileAtomic(file, '{"v":2}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"v":2}');
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe('{"v":1}');
  });
});

describe('readJsonWithRecovery', () => {
  it('recovers from the backup and preserves the corrupt file', () => {
    const file = path.join(tempDir(), 'data.json');
    writeFileAtomic(file, JSON.stringify({ v: 1 }));
    writeFileAtomic(file, JSON.stringify({ v: 2 }));
    fs.writeFileSync(file, '{not json');

    const result = readJsonWithRecovery(file, (raw) => raw as { v: number });

    expect(result.source).toBe('backup');
    expect(result.value).toEqual({ v: 1 });
    expect(result.notices.length).toBeGreaterThan(0);
    expect(result.notices.join(' ')).not.toContain('at ');
    const preserved = fs
      .readdirSync(path.dirname(file))
      .filter((name) => name.includes('.corrupt-'));
    expect(preserved).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('returns null when both copies are unreadable', () => {
    const file = path.join(tempDir(), 'data.json');
    fs.writeFileSync(file, 'nope');
    fs.writeFileSync(`${file}.bak`, 'also nope');

    const result = readJsonWithRecovery(file, (raw) => raw as unknown);

    expect(result.value).toBeNull();
    expect(result.source).toBe('none');
    expect(result.notices.length).toBeGreaterThan(0);
  });
});
