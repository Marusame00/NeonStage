import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretStore, type SecretCrypto } from '../src/main/store/secrets';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonstage-secrets-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const fakeCrypto: SecretCrypto = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decrypt: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
};

describe('SecretStore', () => {
  it('round-trips values through the encrypted file', () => {
    const file = path.join(tempDir(), 'secrets.dat');
    const first = new SecretStore(file, fakeCrypto);
    first.set('twitch.token', 'abc');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('abc');

    const second = new SecretStore(file, fakeCrypto);
    expect(second.isPersistent).toBe(true);
    expect(second.get<string>('twitch.token')).toBe('abc');

    second.delete('twitch.token');
    expect(new SecretStore(file, fakeCrypto).get('twitch.token')).toBeNull();
  });

  it('stays in memory when encryption is unavailable', () => {
    const file = path.join(tempDir(), 'secrets.dat');
    const store = new SecretStore(file, { ...fakeCrypto, isAvailable: () => false });
    store.set('twitch.token', 'abc');

    expect(store.isPersistent).toBe(false);
    expect(store.get<string>('twitch.token')).toBe('abc');
    expect(fs.existsSync(file)).toBe(false);
  });
});
