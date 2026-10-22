import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Where the built web app lives: apps/web/dist, from both src/http and dist/http. */
export function defaultWebDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist');
}

const API_PREFIXES = ['/api/', '/mcp', '/healthz'];

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
      res.header(
        'cache-control',
        path.includes(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.get('/*', (request, reply) => {
    if (API_PREFIXES.some((p) => request.url.startsWith(p))) {
      return reply
        .status(404)
        .send({ error: 'not_found', message: `No route for GET ${request.url}` });
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
  return true;
}
