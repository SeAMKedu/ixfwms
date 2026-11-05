import { OpenMoveInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OPEN, parse, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });
const Guest = z.object({ name: z.string().trim().max(80).nullish() });

/** Moves people may make without an account, as far as the lab's setting allows. */
export function openRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { open } = services;

  /** A lost unit turned up: here (`to`), or back home. */
  app.post('/api/units/:ref/found', OPEN, async (request) => {
    const { ref } = parse(z.object({ ref: z.string() }), request.params);
    const body = parse(
      z.object({ to: z.string().nullish(), name: z.string().trim().max(80).nullish() }),
      request.body ?? {},
    );
    return open.foundUnit(ref, body.to ?? null, body.name ?? null, request.actor);
  });

  app.post('/api/units/:ref/move', OPEN, async (request) => {
    const body = parse(OpenMoveInput, request.body);
    return open.moveUnit(
      parse(RefParams, request.params).ref,
      body.to,
      body.name ?? null,
      request.actor,
    );
  });

  app.post('/api/units/:ref/put-back', OPEN, async (request) =>
    open.putBackUnit(
      parse(RefParams, request.params).ref,
      parse(Guest, request.body).name ?? null,
      request.actor,
    ),
  );

  /** Stock moves open to people without an account (to a workstation, or back where it came from). */
  app.post('/api/stock/:lotId/open-move', OPEN, async (request) => {
    const { lotId } = parse(z.object({ lotId: z.string() }), request.params);
    const body = parse(OpenMoveInput, request.body);
    return open.moveLot(lotId, body.to, body, body.name ?? null, request.actor);
  });

  app.post('/api/stock/:lotId/put-back', OPEN, async (request) => {
    const { lotId } = parse(z.object({ lotId: z.string() }), request.params);
    return open.putBackLot(lotId, parse(Guest, request.body).name ?? null, request.actor);
  });

  app.post('/api/locations/:ref/clear', OPEN, async (request) =>
    open.clear(
      parse(RefParams, request.params).ref,
      parse(Guest, request.body).name ?? null,
      request.actor,
    ),
  );
}
