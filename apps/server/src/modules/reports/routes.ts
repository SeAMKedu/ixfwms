import { ReportInput, ResolveReportInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OPEN, parse, QueryBool, type AppDeps } from '../../http/context.js';

/** Problem reports: anyone may report one. */
export function reportsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { reports } = services;

  /** Anyone may report a problem. */
  app.post('/api/reports', OPEN, async (request, reply) =>
    reply.status(201).send(await reports.create(parse(ReportInput, request.body), request.actor)),
  );

  app.get('/api/reports', async (request) => {
    const q = parse(z.object({ open: QueryBool.optional() }), request.query);
    return reports.list(q.open ?? true);
  });

  app.post('/api/reports/:id/resolve', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { resolution } = parse(ResolveReportInput, request.body);
    return reports.resolve(id, resolution ?? null, request.actor);
  });
}
