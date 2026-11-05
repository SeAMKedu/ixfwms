import {
  hasScope,
  type LocationSummary,
  type UnitEventView,
  type UnitPurchase,
  type UpdateUnitInput,
} from '@ixfwms/domain';
import type { unitEvents, units } from '../../db/schema.js';
import { detail, eventValue, loanReason, personName, type Actor } from '../../lib/context.js';

export function eventView(
  e: typeof unitEvents.$inferSelect,
  user: string | null,
  places: Map<string, LocationSummary>,
): UnitEventView {
  return {
    id: e.id,
    kind: e.kind,
    text: e.kind === 'lent' ? loanReason(e.text) : detail(e.text),
    value: eventValue(e.kind, e.value),
    from: e.fromLocationId ? (places.get(e.fromLocationId) ?? null) : null,
    to: e.toLocationId ? (places.get(e.toLocationId) ?? null) : null,
    by: personName(user ?? e.reporterName),
    guest: !user,
    at: e.at,
  };
}

export function purchaseOf(
  u: Pick<
    typeof units.$inferSelect,
    'purchaseDate' | 'purchaseValueCents' | 'costCenter' | 'usefulLifeYears'
  >,
): UnitPurchase {
  return {
    date: u.purchaseDate,
    valueCents: u.purchaseValueCents,
    costCenter: u.costCenter,
    usefulLifeYears: u.usefulLifeYears,
  };
}

/** Members see what things cost; nobody else does. */
export function purchaseFor(
  u: typeof units.$inferSelect,
  actor: Actor | null,
): UnitPurchase | null {
  return actor && hasScope(actor.scopes, 'inventory') ? purchaseOf(u) : null;
}

/** The purchase details an update changes; what it leaves out stays as it is. */
export function purchasePatch(input: UpdateUnitInput): Partial<typeof units.$inferSelect> {
  const patch: Partial<typeof units.$inferSelect> = {};
  if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate ?? null;
  if (input.purchaseValueCents !== undefined)
    patch.purchaseValueCents = input.purchaseValueCents ?? null;
  if (input.costCenter !== undefined) patch.costCenter = input.costCenter ?? null;
  if (input.usefulLifeYears !== undefined) patch.usefulLifeYears = input.usefulLifeYears ?? null;
  return patch;
}

/** Sorts IPv4 addresses numerically ("10.0.0.9" before "10.0.0.10"); others after them, as text. */
export function ipKey(ip: string | null): string {
  if (!ip) return '~';
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.trim());
  return m
    ? m
        .slice(1)
        .map((n) => n.padStart(3, '0'))
        .join('.')
    : `~${ip}`;
}
