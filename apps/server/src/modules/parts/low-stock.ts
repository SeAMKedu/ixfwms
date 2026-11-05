import { MEASURE_UNITS, unitFactor } from '@ixfwms/domain';
import { sql, type SQL } from 'drizzle-orm';
import { jsonValue } from '../../db/dialect.js';
import { parts, stockLots } from '../../db/schema.js';

/** The unit the minimum is in: the container's (e.g. g for filament), or null for pieces. */
const minUnit = jsonValue(parts.container, ['unit']);

/** A lot's quantity in the minimum's unit (kg as g); null when it measures something else. */
const inMinUnit = sql`case ${sql.join(
  MEASURE_UNITS.flatMap((from) =>
    MEASURE_UNITS.map((to) => [from, to, unitFactor(from, to)] as const)
      .filter(([, , factor]) => factor != null)
      .map(
        ([from, to, factor]) =>
          sql`when ${stockLots.unit} = ${from} and ${minUnit} = ${to} then ${stockLots.quantity} * ${factor}`,
      ),
  ),
  sql` `,
)} end`;

/**
 * The item has a minimum and its free stock is below it. Pieces count toward a minimum in
 * pieces (with usable units); weights, lengths and volumes toward one in the container's unit.
 * Only when every free lot is counted: stock nobody has counted may be plenty.
 */
export function belowMinimum(freeLot: SQL, freeUncounted: SQL, usableUnits: SQL): SQL {
  const sum = (amount: SQL, which: SQL) =>
    sql`coalesce((select sum(${amount}) from ${stockLots} where ${stockLots.partId} = ${parts.id} and ${which} and ${freeLot}), 0)`;
  const pieces = sql`${sum(sql`${stockLots.quantity}`, sql`${stockLots.mode} = 'count'`)} + ${usableUnits}`;
  const measured = sum(inMinUnit, sql`${stockLots.mode} = 'measure'`);
  return sql`(${parts.minStock} is not null and not ${freeUncounted}
    and (case when ${minUnit} is null then ${pieces} else ${measured} end) < ${parts.minStock})`;
}
