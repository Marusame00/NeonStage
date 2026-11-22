import fs from 'node:fs';
import path from 'node:path';

export type RecoverySource = 'primary' | 'backup' | 'none';

export interface RecoveryResult<T> {
  value: T | null;
  source: RecoverySource;
  notices: string[];
}

export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}

interface ReadAttempt<T> {
  ok: boolean;
  existed: boolean;
  value: T | null;
}

function tryRead<T>(file: string, parse: (raw: unknown) => T): ReadAttempt<T> {
  if (!fs.existsSync(file)) return { ok: false, existed: false, value: null };
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ok: true, existed: true, value: parse(raw) };
  } catch {
    return { ok: false, existed: true, value: null };
  }
}

function corruptName(file: string): string {
  const stamp = Date.now();
  let candidate = `${file}.corrupt-${stamp}`;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${file}.corrupt-${stamp}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function readJsonWithRecovery<T>(
  file: string,
  parse: (raw: unknown) => T,
): RecoveryResult<T> {
  const notices: string[] = [];
  const name = path.basename(file);
  const primary = tryRead(file, parse);
  if (primary.ok) return { value: primary.value, source: 'primary', notices };

  if (primary.existed) {
    const preserved = corruptName(file);
    try {
      fs.renameSync(file, preserved);
      notices.push(
        `NeonStage could not read ${name}. The damaged file was kept as ${path.basename(preserved)}.`,
      );
    } catch {
      notices.push(`NeonStage could not read ${name}.`);
    }
  }

  const backup = tryRead(`${file}.bak`, parse);
  if (backup.ok) {
    notices.push(`NeonStage restored ${name} from its backup.`);
    return { value: backup.value, source: 'backup', notices };
  }

  if (primary.existed || backup.existed) {
    notices.push(`NeonStage could not restore ${name}; a fresh copy will be created.`);
  }
  return { value: null, source: 'none', notices };
}
