/** `away` is the built-in "Out of the lab" place where lent units are. */
export const LOCATION_KINDS = ['normal', 'inbox', 'in_transit', 'away'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const PART_STATUSES = ['draft', 'active', 'archived'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

/** What an item is, for filtering lists: stock parts, tools, or devices and machines. */
export const PART_KINDS = ['part', 'tool', 'device'] as const;
export type PartKind = (typeof PART_KINDS)[number];
/** What search can be narrowed to: a kind of item, or builds (things made from parts). */
export const SEARCH_KINDS = [...PART_KINDS, 'build'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Bulk items have stock lots (amounts per place); individual ones have units, each with its own code. */
export const TRACKING_MODES = ['bulk', 'individual'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

/** `lost`: nobody can find it (it may turn up: "Found it"); `retired`: gone for good. */
export const UNIT_STATUSES = [
  'ok',
  'needs_attention',
  'broken',
  'in_repair',
  'lost',
  'retired',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
/** Unit states that count as having the thing (in stock, low stock, "Can we build it?"). */
export const USABLE_UNIT_STATUSES: UnitStatus[] = ['ok', 'needs_attention'];

/** Entries in a unit's log. The first five can be written by hand; the rest are recorded by the app. */
export const UNIT_LOG_KINDS = ['note', 'maintenance', 'firmware', 'problem', 'repaired'] as const;
export const UNIT_EVENT_KINDS = [
  ...UNIT_LOG_KINDS,
  'created',
  'moved',
  'status',
  'lent',
  'returned',
  'found',
] as const;
export type UnitLogKind = (typeof UNIT_LOG_KINDS)[number];
export type UnitEventKind = (typeof UNIT_EVENT_KINDS)[number];

export const REPORT_KINDS = ['broken', 'missing_parts', 'running_low', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * What people without an account may do besides looking and reporting problems: also put
 * things back, and also bring things to a workstation (and clear one). Each level includes the ones before.
 */
export const ANONYMOUS_ACTIONS = ['report', 'put_back', 'workstation'] as const;
export type AnonymousActions = (typeof ANONYMOUS_ACTIONS)[number];

export function anonymousAllows(setting: AnonymousActions, wanted: AnonymousActions): boolean {
  return ANONYMOUS_ACTIONS.indexOf(setting) >= ANONYMOUS_ACTIONS.indexOf(wanted);
}

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
 * Workstation types are tables people bring things to; anyone may bring things there (see ANONYMOUS_ACTIONS).
 * Build types are things made from parts (a gripper, a test rig): what's in them isn't free stock.
 */
export const DEFAULT_LOCATION_TYPES = [
  {
    key: 'building',
    name: 'Building',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
  { key: 'floor', name: 'Floor', movable: false, stayDays: null, workstation: false, build: false },
  {
    key: 'room',
    name: 'Room / lab',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
  {
    key: 'zone',
    name: 'Zone / cell',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
  {
    key: 'cabinet',
    name: 'Cabinet',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
  { key: 'shelf', name: 'Shelf', movable: false, stayDays: null, workstation: false, build: false },
  { key: 'pallet', name: 'Pallet', movable: true, stayDays: 14, workstation: false, build: false },
  {
    key: 'drawer',
    name: 'Drawer',
    movable: true,
    stayDays: null,
    workstation: false,
    build: false,
  },
  { key: 'box', name: 'Box', movable: true, stayDays: null, workstation: false, build: false },
  {
    key: 'bin',
    name: 'Bin / bag',
    movable: true,
    stayDays: null,
    workstation: false,
    build: false,
  },
  {
    key: 'workstation',
    name: 'Workstation / table',
    movable: false,
    stayDays: 1,
    workstation: true,
    build: false,
  },
  // Checked on once a year: is it still in use, or can it be taken apart for parts?
  { key: 'build', name: 'Build', movable: true, stayDays: 365, workstation: false, build: true },
  {
    key: 'device',
    name: 'Device',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
  {
    key: 'system',
    name: 'System',
    movable: false,
    stayDays: null,
    workstation: false,
    build: false,
  },
] as const;

/** Types the app uses itself (the Inbox, people carrying things); not editable. */
export const BUILT_IN_LOCATION_TYPES = ['system', 'in_transit'] as const;
