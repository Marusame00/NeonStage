import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_BYTES = 1024 * 1024;

export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  registerSecret(value: string): void;
  redact(text: string): string;
}

type Level = 'info' | 'warn' | 'error';

function describeDetail(detail: unknown): string {
  if (detail === undefined) return '';
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

class FileLogger implements Logger {
  private readonly secrets = new Set<string>();
  private file: string | null;

  constructor(logDir: string | null) {
    this.file = logDir ? path.join(logDir, 'main.log') : null;
    if (logDir) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch {
        this.file = null;
      }
    }
  }

  info(message: string, detail?: unknown): void {
    this.write('info', message, detail);
  }

  warn(message: string, detail?: unknown): void {
    this.write('warn', message, detail);
  }

  error(message: string, detail?: unknown): void {
    this.write('error', message, detail);
  }

  registerSecret(value: string): void {
    if (typeof value === 'string' && value.length >= 4) this.secrets.add(value);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join('[redacted]');
    out = out.replace(
      /\b(access_token|refresh_token|id_token|client_secret)=([^&\s"']+)/gi,
      '$1=[redacted]',
    );
    out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
    return out;
  }

  private write(level: Level, message: string, detail?: unknown): void {
    const extra = describeDetail(detail);
    const line = `${new Date().toISOString()} ${level} ${this.redact(message)}${
      extra ? ` ${this.redact(extra)}` : ''
    }`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    this.append(`${line}\n`);
  }

  private append(text: string): void {
    if (!this.file) return;
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > MAX_LOG_BYTES) {
        const old = `${this.file}.1`;
        if (fs.existsSync(old)) fs.unlinkSync(old);
        fs.renameSync(this.file, old);
      }
      fs.appendFileSync(this.file, text);
    } catch {
      this.file = null;
    }
  }
}

export function createLogger(logDir: string | null): Logger {
  return new FileLogger(logDir);
}
