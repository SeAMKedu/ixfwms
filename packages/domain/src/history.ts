/* What changed, by whom. */

export type HistoryKind = 'stock' | 'location' | 'edit' | 'unit';

export interface HistoryEntry {
  kind: HistoryKind;
  id: string;
  at: string;
  user: string | null;
  /**
   * add, take, stocktake, move; location moves are "move"; edits use the audit action (create,
   * update, merge…); unit entries use the unit event kind (moved, lent, firmware…).
   */
  action: string;
  part: { code: string; name: string } | null;
  place: { code: string; name: string } | null;
  from: { code: string; name: string } | null;
  to: { code: string; name: string } | null;
  delta: number | null;
  /** Unit entries: the unit, and its event's value (firmware version, status…) and text. */
  unit: { code: string; name: string } | null;
  value: string | null;
  text: string | null;
  /** Moves can be undone while nothing has changed since. */
  undoable: boolean;
}
