import { AddUnitsInput, UnitLogInput, UpdateUnitInput } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

const RefParams = z.object({ ref: z.string() });

/** Units: adding, reading, changing and logging them, and the list of networked ones. */
export function unitsRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { units } = services;

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
}
