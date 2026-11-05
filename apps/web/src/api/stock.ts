import type { AddStockInput, AmountInput, LotView, MoveAmount, StockLevel } from '@ixfwms/domain';
import { api, useChange } from './client';

/** Stock amounts: adding, taking, counting and moving them. */
export const useAddStock = () =>
  useChange((input: AddStockInput) => api<LotView>('/api/stock', { body: input }));
export const useTakeStock = () =>
  useChange((i: { lotId: string; quantity?: number; level?: StockLevel }) =>
    api<LotView>(`/api/stock/${i.lotId}/take`, { body: { quantity: i.quantity, level: i.level } }),
  );
export const useStocktake = () =>
  useChange((i: { lotId: string; amount: AmountInput }) =>
    api<LotView>(`/api/stock/${i.lotId}/stocktake`, { body: i.amount }),
  );
export const useMoveStock = () =>
  useChange(({ lotId, ...body }: { lotId: string; to: string } & MoveAmount) =>
    api<LotView>(`/api/stock/${lotId}/move`, { body }),
  );
