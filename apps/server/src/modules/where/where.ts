import type {
  BuildBrief,
  LocationSummary,
  PartSummary,
  StockLevelDef,
  UnitBrief,
  WhereIsAnswer,
} from '@ixfwms/domain';
import type { PlaceStore } from '../locations/store.js';
import type { PartService } from '../parts/parts.js';
import type { StockService } from '../stock/stock.js';

const STATUS_TEXT: Record<string, string> = {
  needs_attention: 'Someone reported a problem with it.',
  broken: 'Marked broken.',
  in_repair: 'In repair.',
  lost: 'Marked lost; that is where it was last seen.',
  archived: 'Archived.',
};

const place = (p: LocationSummary) => p.address || p.name;
/** Where something is: in a build it's "built into Gripper v3", anywhere else "at <address>". */
const at = (p: LocationSummary) => (p.inBuild ? `built into ${p.inBuild.name}` : `at ${place(p)}`);

/**
 * "Where is the impact drill?": short sentences, one per thing found, meant to be read out
 * by a voice assistant. English, like the rest of the MCP interface.
 */
export class WhereService {
  constructor(
    private readonly parts: PartService,
    private readonly stock: StockService,
    private readonly locations: PlaceStore,
  ) {}

  async ask(query: string, limit = 5): Promise<WhereIsAnswer[]> {
    const { rows, items, builds } = await this.parts.search({ q: query, limit, offset: 0 });
    const levels = await this.stock.levels();
    const byId = new Map(items.map((i) => [i.id, i]));
    const buildById = new Map(builds.map((b) => [b.id, b]));
    return Promise.all(
      rows.map(async (row) => {
        let answer: WhereIsAnswer;
        let to: LocationSummary | null;
        if ('buildId' in row) {
          const build = buildById.get(row.buildId)!;
          [answer, to] = [buildAnswer(build), build.in];
        } else {
          const item = byId.get(row.partId)!;
          [answer, to] = [answerFor(item, row.unitId, levels), placeShown(item, row.unitId)];
        }
        return to?.kind === 'normal'
          ? { ...answer, directions: await this.locations.directions(to.id) }
          : answer;
      }),
    );
  }
}

/** One answer per search result: a unit, or a bulk item with where its stock is. */
function answerFor(
  item: PartSummary,
  unitId: string | null,
  levels: StockLevelDef[],
): WhereIsAnswer {
  const ref = { code: item.code, name: item.name, kind: item.kind };
  const unit = unitId && item.units.find((u) => u.id === unitId);
  if (unit) return { item: ref, unit: unit.code, text: unitSentence(unit) };
  if (item.tracking === 'individual')
    return { item: ref, unit: null, text: `${item.name}: none registered.` };
  if (!item.stock.length) return { item: ref, unit: null, text: `${item.name}: none in stock.` };
  // Level-tracked stock shows the level's key; say its name instead.
  const amount = (display: string) =>
    levels.find((l) => l.key === display)?.name.toLowerCase() ?? display;
  const shown = item.stock.slice(0, 3).map((s) => `${amount(s.display)} ${at(s.place)}`);
  const more = item.stock.length > 3 ? `, and ${item.stock.length - 3} more places` : '';
  return { item: ref, unit: null, text: `${item.name}: ${shown.join(', ')}${more}.` };
}

/** The place an answer names first: where the unit is, or the first place with stock. */
function placeShown(item: PartSummary, unitId: string | null): LocationSummary | null {
  const unit = unitId && item.units.find((u) => u.id === unitId);
  if (unit) return unit.loan ? null : unit.location;
  return item.tracking === 'bulk' ? (item.stock[0]?.place ?? null) : null;
}

function buildAnswer(b: BuildBrief): WhereIsAnswer {
  const item = { code: b.code, name: b.name, kind: 'build' as const };
  if (b.dismantledAt)
    return {
      item,
      unit: null,
      text: `${b.name}: a build, dismantled ${b.dismantledAt.slice(0, 10)}.`,
    };
  const where = b.in ? ` at ${place(b.in)}` : '';
  const things = b.items === 1 ? '1 thing' : `${b.items} things`;
  return { item, unit: null, text: `${b.name}: a build${where}, ${things} in it.` };
}

function unitSentence(u: UnitBrief): string {
  const status = STATUS_TEXT[u.status] ? ` ${STATUS_TEXT[u.status]}` : '';
  if (u.loan) {
    const due = u.loan.dueAt ? `, expected back ${u.loan.dueAt}` : '';
    const who = u.loan.responsible ? `, ${u.loan.responsible} is responsible` : '';
    const why = u.loan.description ? ` (${u.loan.description})` : '';
    const inside = u.loan.place ? ` in ${u.loan.place.name}` : '';
    return `${u.name}: lent out of the lab${inside}${who}${why}${due}.${status}`;
  }
  if (u.location.kind === 'in_transit')
    return `${u.name}: being moved right now (${u.location.name}).${status}`;
  if (u.atHome || !u.home) return `${u.name}: ${at(u.location)}.${status}`;
  return `${u.name}: now ${at(u.location)}; it belongs at ${place(u.home)}.${status}`;
}
