import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Where the built web app lives: apps/web/dist, from both src/http and dist/http. */
export function defaultWebDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist');
}

const API_PREFIXES = ['/api/', '/mcp', '/healthz'];

/**
 * For the app's pages: scripts only from this server, so an injected one can't run and read the
 * login token, and no other site may frame the app. Styles inline are fine (React sets them).
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Serves the web app with a single-page-app fallback: any other GET gets index.html,
 * so deep links like /L/A3F9 from a QR label open the right screen.
 * Returns false when no build exists (the server then serves its minimal HTML pages instead).
 */
export async function registerWebApp(app: FastifyInstance, webDir: string): Promise<boolean> {
  if (!existsSync(join(webDir, 'index.html'))) return false;
  const assets = `${sep}assets${sep}`;
  // wildcard: false registers one route per built file; hashed assets can be cached forever.
  await app.register(fastifyStatic, {
    root: webDir,
    wildcard: false,
    setHeaders(res, path) {
      if (path.endsWith('.html')) res.header('content-security-policy', APP_CSP);
      res.header(
        'cache-control',
        path.includes(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.get('/*', (request, reply) => {
    const path = decodeURIComponent(request.url.split('?')[0] ?? '/');
    if (API_PREFIXES.some((p) => path.startsWith(p))) {
      return reply.status(404).send({ error: 'not_found', message: `No route for GET ${path}` });
    }
    // Files added after startup (a rebuilt web app) are served too; a missing asset is a 404,
    // never index.html, so the browser doesn't get HTML for a script.
    const file = normalize(path).replace(/^[/\\]+/, '');
    if (file && !file.startsWith('..') && isFile(join(webDir, file))) return reply.sendFile(file);
    if (path.startsWith('/assets/')) {
      return reply.status(404).send({ error: 'not_found', message: `No file ${path}` });
    }
    return reply
      .header('cache-control', 'no-cache')
      .header('content-security-policy', APP_CSP)
      .sendFile('index.html');
  });
  return true;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
