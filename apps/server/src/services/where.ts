import type {
  LocationSummary,
  PartSummary,
  StockLevelDef,
  UnitBrief,
  WhereIsAnswer,
} from '@ixfwms/domain';
import type { PartService } from './parts.js';
import type { StockService } from './stock.js';

const STATUS_TEXT: Record<string, string> = {
  needs_attention: 'Someone reported a problem with it.',
  broken: 'Marked broken.',
  in_repair: 'In repair.',
  retired: 'Retired.',
};

const place = (p: LocationSummary) => p.address || p.name;

/**
 * "Where is the impact drill?": short sentences, one per thing found, meant to be read out
 * by a voice assistant. English, like the rest of the MCP interface.
 */
export class WhereService {
  constructor(
    private readonly parts: PartService,
    private readonly stock: StockService,
  ) {}

  async ask(query: string, limit = 5): Promise<WhereIsAnswer[]> {
    const { items } = await this.parts.search({ q: query, limit, offset: 0 });
    const levels = await this.stock.levels();
    return items.flatMap((item) => answersFor(item, levels));
  }
}

function answersFor(item: PartSummary, levels: StockLevelDef[]): WhereIsAnswer[] {
  const ref = { code: item.code, name: item.name, kind: item.kind };
  if (item.tracking === 'individual') {
    if (!item.units.length)
      return [{ item: ref, unit: null, text: `${item.name}: none registered.` }];
    return item.units
      .filter((u) => u.status !== 'retired')
      .map((u) => ({ item: ref, unit: u.code, text: unitSentence(u) }));
  }
  if (!item.stock.length) return [{ item: ref, unit: null, text: `${item.name}: none in stock.` }];
  // Level-tracked stock shows the level's key; say its name instead.
  const amount = (display: string) =>
    levels.find((l) => l.key === display)?.name.toLowerCase() ?? display;
  const shown = item.stock.slice(0, 3).map((s) => `${amount(s.display)} at ${place(s.place)}`);
  const more = item.stock.length > 3 ? `, and ${item.stock.length - 3} more places` : '';
  return [{ item: ref, unit: null, text: `${item.name}: ${shown.join(', ')}${more}.` }];
}

function unitSentence(u: UnitBrief): string {
  const status = STATUS_TEXT[u.status] ? ` ${STATUS_TEXT[u.status]}` : '';
  if (u.loan) {
    const due = u.loan.dueAt ? `, expected back ${u.loan.dueAt}` : '';
    return `${u.name}: lent out of the lab, ${u.loan.responsible} is responsible (${u.loan.description})${due}.${status}`;
  }
  if (u.location.kind === 'in_transit')
    return `${u.name}: being moved right now (${u.location.name}).${status}`;
  if (u.atHome || !u.home) return `${u.name}: at ${place(u.location)}.${status}`;
  return `${u.name}: now at ${place(u.location)}; it belongs at ${place(u.home)}.${status}`;
}
