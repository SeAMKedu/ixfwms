import {
  AddUnitsInput,
  LendInput,
  OpenMoveInput,
  ReportInput,
  UnitLogInput,
  UpdateUnitInput,
} from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, QueryBool, type AppDeps } from '../context.js';

const RefParams = z.object({ ref: z.string() });
const Guest = z.object({ name: z.string().trim().max(80).nullish() });

/** Units, loans, problem reports, and the moves people may make without an account. */
export function registerUnitRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { units, reports, open, where } = services;

  /** Deletes a unit made by mistake; not while it's lent out. */
  app.delete('/api/units/:ref', async (request, reply) => {
    await services.deletes.unit(
      parse(z.object({ ref: z.string() }), request.params).ref,
      request.actor,
    );
    return reply.status(204).send();
  });

  app.post('/api/units', async (request, reply) =>
    reply.status(201).send(await units.add(parse(AddUnitsInput, request.body), request.actor)),
  );

  /** Broken, reported, in repair, or due for a check. */
  app.get('/api/units/attention', () => units.attention());

  app.get('/api/units/:ref', async (request) =>
    units.detail(parse(RefParams, request.params).ref, request.actor),
  );

  app.patch('/api/units/:ref', async (request) =>
    units.update(
      parse(RefParams, request.params).ref,
      parse(UpdateUnitInput, request.body),
      request.actor,
    ),
  );

  app.post('/api/units/:ref/log', async (request) =>
    units.log(
      parse(RefParams, request.params).ref,
      parse(UnitLogInput, request.body),
      request.actor,
    ),
  );

  /** Open to people without an account, as far as the lab's setting allows. */
  app.post('/api/units/:ref/move', async (request) => {
    const body = parse(OpenMoveInput, request.body);
    return open.moveUnit(
      parse(RefParams, request.params).ref,
      body.to,
      body.name ?? null,
      request.actor,
    );
  });

  app.post('/api/units/:ref/put-back', async (request) =>
    open.putBackUnit(
      parse(RefParams, request.params).ref,
      parse(Guest, request.body).name ?? null,
      request.actor,
    ),
  );

  app.post('/api/units/:ref/lend', async (request) =>
    units.lend(parse(RefParams, request.params).ref, parse(LendInput, request.body), request.actor),
  );

  app.post('/api/units/:ref/return', async (request) => {
    const { to } = parse(z.object({ to: z.string().nullish() }), request.body);
    return units.returnUnit(parse(RefParams, request.params).ref, to ?? null, request.actor);
  });

  app.get('/api/loans', async (request) => {
    const q = parse(z.object({ open: QueryBool.optional() }), request.query);
    return units.loanList(q.open ?? true);
  });

  app.get('/api/network', async (request) => units.network(request.actor));

  app.get('/api/network.csv', async (request, reply) => {
    const rows = await units.network(request.actor);
    const cell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'ip,hostname,mac,name,code,item,place',
      ...rows.map((r) =>
        [r.ipAddress, r.hostname, r.macAddress, r.unit.name, r.unit.code, r.part.name, r.place]
          .map(cell)
          .join(','),
      ),
    ].join('\r\n');
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="ixfwms-network.csv"')
      .send(`${csv}\r\n`);
  });

  /** Anyone may report a problem. */
  app.post('/api/reports', async (request, reply) =>
    reply.status(201).send(await reports.create(parse(ReportInput, request.body), request.actor)),
  );

  app.get('/api/reports', async (request) => {
    const q = parse(z.object({ open: QueryBool.optional() }), request.query);
    return reports.list(q.open ?? true);
  });

  app.post('/api/reports/:id/resolve', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { resolution } = parse(
      z.object({ resolution: z.string().trim().max(2000).nullish() }),
      request.body,
    );
    return reports.resolve(id, resolution ?? null, request.actor);
  });

  /** Stock moves open to people without an account (to a workstation, or back where it came from). */
  app.post('/api/stock/:lotId/open-move', async (request) => {
    const { lotId } = parse(z.object({ lotId: z.string() }), request.params);
    const body = parse(OpenMoveInput, request.body);
    return open.moveLot(lotId, body.to, body, body.name ?? null, request.actor);
  });

  app.post('/api/stock/:lotId/put-back', async (request) => {
    const { lotId } = parse(z.object({ lotId: z.string() }), request.params);
    return open.putBackLot(lotId, parse(Guest, request.body).name ?? null, request.actor);
  });

  app.post('/api/locations/:ref/clear', async (request) =>
    open.clear(
      parse(RefParams, request.params).ref,
      parse(Guest, request.body).name ?? null,
      request.actor,
    ),
  );

  /** "Where is the impact drill?" as short sentences. */
  app.get('/api/where', async (request) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(200) }), request.query);
    return where.ask(q);
  });
}
