import { AddStockInput, AmountInput, MoveAmount } from '@ixfwms/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type AppDeps } from '../../http/context.js';

const LotParams = z.object({ lotId: z.string() });

export function registerStockRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { stock } = services;

  app.post('/api/stock', async (request, reply) => {
    const lot = await stock.add(parse(AddStockInput, request.body), request.actor);
    return reply.status(201).send(lot);
  });

  app.post('/api/stock/:lotId/take', async (request) => {
    const { lotId } = parse(LotParams, request.params);
    const body = parse(
      z.object({
        quantity: z.number().positive().nullish(),
        level: z.string().trim().min(1).max(60).nullish(),
      }),
      request.body,
    );
    return stock.take(lotId, body.quantity ?? null, body.level ?? null, request.actor);
  });

  app.post('/api/stock/:lotId/stocktake', async (request) => {
    const { lotId } = parse(LotParams, request.params);
    return stock.stocktake(lotId, parse(AmountInput, request.body), request.actor);
  });

  app.post('/api/stock/:lotId/move', async (request) => {
    const { lotId } = parse(LotParams, request.params);
    const body = parse(MoveAmount.extend({ to: z.string() }), request.body);
    return stock.move(lotId, body.to, body, request.actor);
  });
}
