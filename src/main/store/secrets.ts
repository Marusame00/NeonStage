import fs from 'node:fs';
import { writeFileAtomic } from './atomic';

export interface SecretCrypto {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface SecretFile {
  format: 'neonstage-secrets';
  version: 1;
  data: string;
}

export class SecretStore {
  private readonly data = new Map<string, unknown>();
  private readonly file: string;
  private readonly crypto: SecretCrypto;
  private readonly persistent: boolean;

  constructor(file: string, crypto: SecretCrypto) {
    this.file = file;
    this.crypto = crypto;
    this.persistent = crypto.isAvailable();
    if (this.persistent) this.load();
  }

  get isPersistent(): boolean {
    return this.persistent;
  }

  get<T>(key: string): T | null {
    const value = this.data.get(key);
    return value === undefined ? null : (value as T);
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value);
    this.persist();
  }

  delete(key: string): void {
    if (!this.data.delete(key)) return;
    this.persist();
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SecretFile;
      if (parsed.format !== 'neonstage-secrets' || typeof parsed.data !== 'string') return;
      const decrypted = this.crypto.decrypt(Buffer.from(parsed.data, 'base64'));
      const map = JSON.parse(decrypted) as Record<string, unknown>;
      for (const [key, value] of Object.entries(map)) this.data.set(key, value);
    } catch {
      this.data.clear();
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    const plain = JSON.stringify(Object.fromEntries(this.data));
    const encrypted = this.crypto.encrypt(plain);
    const payload: SecretFile = {
      format: 'neonstage-secrets',
      version: 1,
      data: encrypted.toString('base64'),
    };
    writeFileAtomic(this.file, JSON.stringify(payload));
  }
}
