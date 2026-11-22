import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetRef } from '../../shared/model';
import { writeFileAtomic } from './atomic';

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const ASSET_ID = /^[a-f0-9]{64}\.(png|jpe?g|gif|webp|svg)$/;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

interface AssetIndexEntry {
  name: string;
  mime: string;
  size: number;
}

export function isAssetId(value: string): boolean {
  return ASSET_ID.test(value);
}

export class AssetStore {
  private readonly index = new Map<string, AssetIndexEntry>();
  private readonly indexFile: string;

  constructor(private readonly dir: string) {
    this.indexFile = path.join(dir, 'index.json');
    fs.mkdirSync(dir, { recursive: true });
    this.loadIndex();
  }

  importFile(srcPath: string): AssetRef | null {
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(srcPath);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return null;
    const buffer = fs.readFileSync(srcPath);
    const id = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${ext}`;
    const target = path.join(this.dir, id);
    if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
    const name = path.basename(srcPath);
    this.index.set(id, { name, mime, size: buffer.length });
    this.saveIndex();
    return { id, name, mime, size: buffer.length };
  }

  resolve(id: string): { path: string; mime: string } | null {
    if (!isAssetId(id)) return null;
    const file = path.join(this.dir, id);
    if (!fs.existsSync(file)) return null;
    const mime = MIME_BY_EXT[id.slice(id.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
    return { path: file, mime };
  }

  readBase64(id: string): string | null {
    const resolved = this.resolve(id);
    if (!resolved) return null;
    try {
      return fs.readFileSync(resolved.path).toString('base64');
    } catch {
      return null;
    }
  }

  writeFromBase64(id: string, name: string, mime: string, dataBase64: string): boolean {
    if (!isAssetId(id)) return false;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, 'base64');
    } catch {
      return false;
    }
    if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) return false;
    const target = path.join(this.dir, id);
    if (!fs.existsSync(target)) {
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, target);
    }
    this.index.set(id, { name, mime, size: buffer.length });
    this.saveIndex();
    return true;
  }

  private loadIndex(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as Record<string, AssetIndexEntry>;
      for (const [id, entry] of Object.entries(raw)) {
        if (!isAssetId(id) || !entry || typeof entry !== 'object') continue;
        this.index.set(id, {
          name: typeof entry.name === 'string' ? entry.name : id,
          mime: typeof entry.mime === 'string' ? entry.mime : 'application/octet-stream',
          size: typeof entry.size === 'number' ? entry.size : 0,
        });
      }
    } catch {
      this.index.clear();
    }
  }

  private saveIndex(): void {
    writeFileAtomic(this.indexFile, JSON.stringify(Object.fromEntries(this.index), null, 2));
  }
}
