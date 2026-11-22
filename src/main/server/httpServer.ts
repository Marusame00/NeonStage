import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ServerStatus } from '../../shared/ipc';
import { parseOutputPath } from '../../shared/output';
import type { SseHub } from './sseHub';

export interface OverlayServerOptions {
  overlayDir: string;
  hub: SseHub;
  assets: { resolve(id: string): { path: string; mime: string } | null };
  appName: string;
  version: string;
}

const OUTPUT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://static-cdn.jtvnw.net https://yt3.ggpht.com https://yt4.ggpht.com https://lh3.googleusercontent.com; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

const MEDIA_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

const STATIC_MIME: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  png: 'image/png',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
};

function portInUseMessage(port: number): string {
  return `Port ${port} is already in use by another program. NeonStage does not switch ports automatically because your OBS Browser Sources point at this port. Close the other program or choose a different port in Outputs → Server (then update the URLs in OBS).`;
}

function portDeniedMessage(port: number): string {
  return `NeonStage is not allowed to use port ${port}. Choose a different port in Outputs → Server (then update the URLs in OBS).`;
}

export class OverlayServer {
  private server: http.Server | null = null;
  private currentPort = 0;
  private currentStatus: ServerStatus = { state: 'stopped', port: 0, baseUrl: null };

  constructor(private readonly options: OverlayServerOptions) {}

  get status(): ServerStatus {
    return this.currentStatus;
  }

  get port(): number {
    return this.currentPort;
  }

  get boundAddress(): { address: string; port: number } | null {
    const address = this.server?.address();
    if (!address || typeof address === 'string') return null;
    return { address: address.address, port: address.port };
  }

  start(port: number): Promise<ServerStatus> {
    if (this.server) return Promise.resolve(this.currentStatus);
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res);
      });
      let settled = false;

      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {
          server.closeAllConnections();
        }
        this.server = null;
        this.currentPort = port;
        this.currentStatus = { state: 'error', port, baseUrl: null, message };
        resolve(this.currentStatus);
      };

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') fail(portInUseMessage(port));
        else if (error.code === 'EACCES') fail(portDeniedMessage(port));
        else fail(`NeonStage could not start its local server on port ${port}.`);
      });

      server.listen(port, '127.0.0.1', () => {
        if (settled) return;
        settled = true;
        const address = server.address();
        const actual = typeof address === 'object' && address ? address.port : port;
        this.server = server;
        this.currentPort = actual;
        this.currentStatus = {
          state: 'running',
          port: actual,
          baseUrl: `http://127.0.0.1:${actual}`,
        };
        resolve(this.currentStatus);
      });
    });
  }

  stop(): Promise<void> {
    this.options.hub.closeAll();
    const server = this.server;
    this.server = null;
    this.currentStatus = { state: 'stopped', port: this.currentPort, baseUrl: null };
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        this.text(res, 405, 'Method Not Allowed');
        return;
      }
      if (!this.hostAllowed(req.headers.host)) {
        this.text(res, 403, 'Forbidden');
        return;
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (pathname === '/health') {
        this.json(res, { ok: true, app: this.options.appName, version: this.options.version });
        return;
      }

      if (pathname === '/') {
        this.text(
          res,
          200,
          `${this.options.appName} is running.\n\nProgram output: /output/live\n`,
        );
        return;
      }

      if (pathname.startsWith('/output/')) {
        const target = parseOutputPath(pathname, 'output');
        if (!target) {
          this.text(res, 404, 'Not found');
          return;
        }
        this.serveOutputIndex(res, method);
        return;
      }

      if (pathname.startsWith('/events/')) {
        const target = parseOutputPath(pathname, 'events');
        if (!target) {
          this.text(res, 404, 'Not found');
          return;
        }
        if (method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          });
          res.end();
          return;
        }
        this.options.hub.attach(req, res, target);
        return;
      }

      if (pathname.startsWith('/static/')) {
        this.serveStatic(pathname, res, method);
        return;
      }

      if (pathname.startsWith('/media/')) {
        this.serveMedia(pathname, res, method);
        return;
      }

      this.text(res, 404, 'Not found');
    } catch {
      this.text(res, 500, 'Internal error');
    }
  }

  private hostAllowed(host: string | undefined): boolean {
    const value = (host ?? '').toLowerCase();
    const port = this.currentPort;
    return (
      value === `127.0.0.1:${port}` ||
      value === `localhost:${port}` ||
      value === `[::1]:${port}`
    );
  }

  private serveOutputIndex(res: http.ServerResponse, method: string): void {
    let html: Buffer;
    try {
      html = fs.readFileSync(path.join(this.options.overlayDir, 'index.html'));
    } catch {
      this.text(res, 500, 'Internal error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': OUTPUT_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Length': html.length,
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(html);
  }

  private serveStatic(pathname: string, res: http.ServerResponse, method: string): void {
    const raw = pathname.slice('/static/'.length);
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      this.text(res, 400, 'Bad request');
      return;
    }
    if (
      decoded.length === 0 ||
      decoded.includes('\0') ||
      decoded.includes('\\') ||
      decoded.split('/').some((segment) => segment === '..')
    ) {
      this.text(res, 400, 'Bad request');
      return;
    }

    const root = path.resolve(this.options.overlayDir);
    const resolved = path.resolve(root, decoded);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      this.text(res, 400, 'Bad request');
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      this.text(res, 404, 'Not found');
      return;
    }
    if (!stat.isFile()) {
      this.text(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(resolved).slice(1).toLowerCase();
    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': stat.size,
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(resolved);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  private serveMedia(pathname: string, res: http.ServerResponse, method: string): void {
    const id = pathname.slice('/media/'.length);
    const asset = this.options.assets.resolve(id);
    if (!asset) {
      this.text(res, 404, 'Not found');
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(asset.path);
    } catch {
      this.text(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': asset.mime,
      'Content-Security-Policy': MEDIA_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(asset.path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  private json(res: http.ServerResponse, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private text(res: http.ServerResponse, status: number, body: string): void {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
