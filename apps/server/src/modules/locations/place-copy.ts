import {
  DuplicateLocationInput,
  nextFreeName,
  nextShortName,
  type LocationSummary,
} from '@ixfwms/domain';
import { eq, isNull, like } from 'drizzle-orm';
import { many, type Db, type Executor } from '../../db/client.js';
import { locations, locationTypes } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import type { LocationService } from './locations.js';

/** Copying a place, with everything below it. Reached through LocationService.duplicate. */
export class PlaceCopy {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
  ) {}

  /**
   * Copies a place with everything below it (names, types, descriptions; not stock), each copy
   * with a new code. Copies are named on from the original (Cabinet A → Cabinet B, C…) unless a
   * name is given. `afterCopy` gets original → copy ids, for copying maps along.
   */
  async duplicate(
    ref: string,
    input: DuplicateLocationInput,
    actor: Actor | null,
    afterCopy?: (tx: Executor, pairs: Map<string, string>) => Promise<void>,
  ): Promise<LocationSummary[]> {
    const who = requireScope(actor, 'inventory');
    const { name, parent, count } = DuplicateLocationInput.parse(input);
    return this.db.transaction(async (tx) => {
      const original = await this.locations.resolve(ref, tx);
      if (original.kind !== 'normal') throw invalid('places.cantCopy', { name: original.name });
      const parentId =
        parent === undefined
          ? original.parentId
          : parent && (await this.locations.resolve(parent, tx)).id;
      const inside = await many(
        tx
          .select()
          .from(locations)
          .where(like(locations.path, `${original.path}%`)),
      );
      const types = new Map(
        (await many(tx.select().from(locationTypes))).map((t) => [t.id, t.key]),
      );
      const copies: LocationSummary[] = [];
      let previous = original.name;
      let shortRoot = original.shortName;
      for (let n = 0; n < count; n++) {
        const siblingRows = await many(
          tx
            .select()
            .from(locations)
            .where(parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId)),
        );
        const taken = siblingRows.map((s) => s.name);
        const copyName = name && n === 0 ? name : nextFreeName(previous, taken);
        previous = copyName;
        // A set short name steps on too (A → B); a guessed one follows the new name by itself.
        if (shortRoot) {
          const shorts = (await this.locations.summaries(tx, siblingRows)).map((x) =>
            x.short.toLowerCase(),
          );
          do shortRoot = nextShortName(shortRoot);
          while (shorts.includes(shortRoot.toLowerCase()));
        }
        const pairs = new Map<string, string>();
        // Parents come before children when sorted by path length.
        for (const row of [...inside].sort((a, b) => a.path.length - b.path.length)) {
          const isRoot = row.id === original.id;
          const copy = await this.locations.insert(tx, {
            name: isRoot ? copyName : row.name,
            parent: isRoot ? parentId : pairs.get(row.parentId!)!,
            typeKey: types.get(row.typeId) ?? 'box',
            kind: 'normal',
            description: row.description,
            shortName: isRoot ? shortRoot : row.shortName,
            // The copy stands somewhere else; what's inside it is found the same way.
            hint: isRoot ? null : row.hint,
            numberFrom: row.numberFrom,
          });
          pairs.set(row.id, copy.id);
          if (isRoot) copies.push(await this.locations.summarize(tx, copy));
        }
        await afterCopy?.(tx, pairs);
        await audit(tx, who, 'duplicate', 'location', pairs.get(original.id)!, {
          from: original.id,
          places: pairs.size,
        });
      }
      return copies;
    });
  }
}
