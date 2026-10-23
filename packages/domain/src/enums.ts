export const LOCATION_KINDS = ['normal', 'inbox', 'in_transit'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const PART_STATUSES = ['draft', 'active', 'archived'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const ATTACHMENT_KINDS = [
  'photo',
  'datasheet',
  'cad',
  'model',
  'drawing',
  'product_page',
  'link',
  'other',
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const MOVEMENT_REASONS = ['add', 'take', 'adjust', 'stocktake', 'move'] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export const USER_ROLES = ['viewer', 'member', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * API token scopes. `inventory` allows creating and moving things (drafts, stock, locations),
 * `write` additionally allows confirming drafts and archiving, `admin` manages users and tokens.
 */
export const SCOPES = ['read', 'inventory', 'write', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

const SCOPE_RANK: Record<Scope, number> = { read: 0, inventory: 1, write: 2, admin: 3 };

export function hasScope(granted: readonly Scope[], required: Scope): boolean {
  return granted.some((s) => SCOPE_RANK[s] >= SCOPE_RANK[required]);
}

/** Location types seeded on first start. They are data, so labs can add their own. */
/**
 * Place types a new database starts with; they can be renamed, added and removed in the app.
 * Movable ones (containers) aren't part of addresses, so carrying them around doesn't change any.
 * Types with `stayDays` are temporary: their places are flagged when left untouched that long.
 */
export const DEFAULT_LOCATION_TYPES = [
  { key: 'building', name: 'Building', movable: false, stayDays: null },
  { key: 'floor', name: 'Floor', movable: false, stayDays: null },
  { key: 'room', name: 'Room / lab', movable: false, stayDays: null },
  { key: 'zone', name: 'Zone / cell', movable: false, stayDays: null },
  { key: 'cabinet', name: 'Cabinet', movable: false, stayDays: null },
  { key: 'shelf', name: 'Shelf', movable: false, stayDays: null },
  { key: 'pallet', name: 'Pallet', movable: true, stayDays: 14 },
  { key: 'drawer', name: 'Drawer', movable: true, stayDays: null },
  { key: 'box', name: 'Box', movable: true, stayDays: null },
  { key: 'bin', name: 'Bin / bag', movable: true, stayDays: null },
  { key: 'device', name: 'Device', movable: false, stayDays: null },
  { key: 'system', name: 'System', movable: false, stayDays: null },
] as const;

/** Types the app uses itself (the Inbox, people carrying things); not editable. */
export const BUILT_IN_LOCATION_TYPES = ['system', 'in_transit'] as const;
