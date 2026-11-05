import { ImportMapping, ImportOptions, ImportRow } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

export function importRoutes(app: FastifyInstance, { services }: AppDeps): void {
  /** Rows already mapped to fields by the client. `dryRun: true` previews without changing anything. */
  app.post('/api/import/parts', async (request) => {
    const body = parse(
      z.object({
        rows: z.array(ImportRow).min(1),
        options: ImportOptions.default({ matchExisting: true, blankQuantity: 'none' }),
        dryRun: z.boolean().default(true),
      }),
      request.body,
    );
    return services.import.importParts(body.rows, body.options, request.actor, body.dryRun);
  });

  app.get('/api/import/mappings', () => services.import.listMappings());

  app.delete('/api/import/mappings/:name', async (request, reply) => {
    const { name } = parse(z.object({ name: z.string().min(1) }), request.params);
    await services.import.deleteMapping(name, request.actor);
    return reply.status(204).send();
  });

  app.put('/api/import/mappings', async (request, reply) => {
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100), mapping: ImportMapping }),
      request.body,
    );
    await services.import.saveMapping(body.name, body.mapping, request.actor);
    return reply.status(204).send();
  });
}
