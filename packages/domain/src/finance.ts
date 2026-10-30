import type { UnitStatus } from './enums.js';

/** What finance wants to know about a tool or device. */
export interface UnitPurchase {
  date: string | null;
  valueCents: number | null;
  costCenter: string | null;
  /** Estimate, for working out depreciation. */
  usefulLifeYears: number | null;
}

/** One line of the write-off list: a unit with its purchase details and whether it's gone. */
export interface WriteOffRow {
  code: string;
  name: string;
  serialNo: string | null;
  status: UnitStatus;
  purchase: UnitPurchase;
  /** When it was archived or marked lost; null while it's in use. */
  removedAt: string | null;
}
