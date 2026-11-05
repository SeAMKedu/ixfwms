import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../http/context.js';

/** Tools and devices written off, with what they cost. */
export function writeOffsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  app.get('/api/write-offs', async (request) => services.writeOffs.list(request.actor));
}
