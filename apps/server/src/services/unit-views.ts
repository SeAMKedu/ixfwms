import type { LocationSummary, UnitEventView } from '@ixfwms/domain';
import type { unitEvents } from '../db/schema.js';
import { loanReason, personName } from './context.js';

export function eventView(
  e: typeof unitEvents.$inferSelect,
  user: string | null,
  places: Map<string, LocationSummary>,
): UnitEventView {
  return {
    id: e.id,
    kind: e.kind,
    text: e.kind === 'lent' ? loanReason(e.text) : e.text,
    value: e.value,
    from: e.fromLocationId ? (places.get(e.fromLocationId) ?? null) : null,
    to: e.toLocationId ? (places.get(e.toLocationId) ?? null) : null,
    by: personName(user ?? e.reporterName),
    guest: !user,
    at: e.at,
  };
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
