import { AddToBuildInput, DismantleInput, MakeBuildInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, QueryBool, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });

/** Builds: made from a parts list, filled from free stock, taken apart again. */
export function buildsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { builds } = services;

  /** A build made from a parts list: the parts are moved in from free stock. */
  app.post('/api/builds', async (request, reply) =>
    reply.status(201).send(await builds.make(parse(MakeBuildInput, request.body), request.actor)),
  );

  /** The Builds page: standing builds, or the dismantled ones. */
  app.get('/api/builds', async (request) => {
    const { dismantled } = parse(z.object({ dismantled: QueryBool.optional() }), request.query);
    return builds.list(dismantled ?? false);
  });

  /** Puts an item into a build from free stock. */
  app.post('/api/builds/:ref/parts', async (request) =>
    builds.addParts(
      parse(RefParams, request.params).ref,
      parse(AddToBuildInput, request.body),
      request.actor,
    ),
  );

  /** Takes a build apart: back where everything came from, or onto `to`. */
  app.post('/api/locations/:ref/dismantle', async (request) =>
    builds.dismantle(
      parse(RefParams, request.params).ref,
      parse(DismantleInput, request.body ?? {}),
      request.actor,
    ),
  );
}
