import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { labelsCsv, labelSvg, qrDxf, qrSvg } from '../../labels/render.js';
import { baseUrl, parse, QueryBool, type AppDeps } from '../context.js';

const LabelQuery = z.object({
  codes: z.string().optional().describe('Comma-separated codes'),
  location: z.string().optional(),
  recursive: QueryBool.optional(),
  include: z.enum(['locations', 'parts', 'all']).default('locations'),
});
const Ecl = z.enum(['L', 'M', 'Q', 'H']);

export function registerLabelRoutes(app: FastifyInstance, { config, services }: AppDeps): void {
  const { labels } = services;

  const collect = async (request: FastifyRequest) => {
    const q = parse(LabelQuery, request.query);
    const base = baseUrl(config, request);
    if (q.location)
      return labels.forLocation(
        q.location,
        { recursive: q.recursive ?? false, include: q.include },
        base,
      );
    const codes = (q.codes ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return labels.forCodes(codes, base);
  };

  /** What a scanned or typed code is: a place, a part, a blank label, or nothing. */
  app.get('/api/codes/:code', async (request) =>
    labels.lookup(parse(z.object({ code: z.string() }), request.params).code),
  );

  app.get('/api/labels', collect);

  app.get('/api/labels.csv', async (request, reply) =>
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="ixfwms-labels.csv"')
      .send(labelsCsv(await collect(request))),
  );

  app.post('/api/labels/blank', async (request, reply) => {
    const body = parse(
      z.object({ count: z.number().int(), format: z.enum(['json', 'csv']).default('json') }),
      request.body,
    );
    const result = await labels.blank(body.count, request.actor, baseUrl(config, request));
    if (body.format === 'json') return result;
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="ixfwms-blank-labels.csv"')
      .send(labelsCsv(result));
  });

  const one = async (request: FastifyRequest) => {
    const { code } = parse(z.object({ code: z.string() }), request.params);
    const [label] = await labels.forCodes([code], baseUrl(config, request));
    return label!;
  };

  app.get('/api/labels/:code/label.svg', async (request, reply) => {
    const q = parse(
      z.object({
        tape: z.coerce
          .number()
          .pipe(z.union([z.literal(9), z.literal(12), z.literal(24)]))
          .default(12),
        ecl: Ecl.default('M'),
      }),
      request.query,
    );
    return reply.type('image/svg+xml').send(labelSvg(await one(request), q.tape, q.ecl));
  });

  app.get('/api/labels/:code/qr.svg', async (request, reply) => {
    const q = parse(
      z.object({ size: z.coerce.number().positive().max(500).optional(), ecl: Ecl.default('M') }),
      request.query,
    );
    return reply
      .type('image/svg+xml')
      .send(qrSvg((await one(request)).qr, { sizeMm: q.size, ecl: q.ecl }));
  });

  /** For laser engraving: error correction Q by default, survives scratches better. */
  app.get('/api/labels/:code/qr.dxf', async (request, reply) => {
    const q = parse(
      z.object({
        module: z.coerce.number().positive().max(10).default(1),
        ecl: Ecl.default('Q'),
        card: QueryBool.optional(),
      }),
      request.query,
    );
    const label = await one(request);
    return reply
      .type('application/dxf')
      .header('content-disposition', `attachment; filename="ixfwms-${label.code}.dxf"`)
      .send(qrDxf(label.qr, { moduleMm: q.module, ecl: q.ecl, card: q.card ?? false }));
  });
}
