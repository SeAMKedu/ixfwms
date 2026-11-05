import { LendInput, ReturnPlaceInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, QueryBool, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });

/** Lending units and whole containers out of the lab, and getting them back. */
export function loansRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { loans } = services;

  app.get('/api/loans', async (request) => {
    const q = parse(z.object({ open: QueryBool.optional() }), request.query);
    return loans.list(q.open ?? true);
  });

  app.post('/api/units/:ref/lend', async (request) =>
    loans.lendUnit(
      parse(RefParams, request.params).ref,
      parse(LendInput, request.body),
      request.actor,
    ),
  );

  app.post('/api/units/:ref/return', async (request) => {
    const { to } = parse(z.object({ to: z.string().nullish() }), request.body);
    return loans.returnUnit(parse(RefParams, request.params).ref, to ?? null, request.actor);
  });

  /** A container goes out with everything in it, and comes back with what's missing marked lost. */
  app.post('/api/locations/:ref/lend', async (request) =>
    loans.lendPlace(
      parse(RefParams, request.params).ref,
      parse(LendInput, request.body),
      request.actor,
    ),
  );

  app.post('/api/locations/:ref/return', async (request) =>
    loans.returnPlace(
      parse(RefParams, request.params).ref,
      parse(ReturnPlaceInput, request.body ?? {}),
      request.actor,
    ),
  );
}
