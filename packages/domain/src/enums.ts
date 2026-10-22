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
export const DEFAULT_LOCATION_TYPES = [
  { key: 'building', name: 'Building' },
  { key: 'floor', name: 'Floor' },
  { key: 'room', name: 'Room / lab' },
  { key: 'zone', name: 'Zone / cell' },
  { key: 'cabinet', name: 'Cabinet' },
  { key: 'shelf', name: 'Shelf' },
  { key: 'drawer', name: 'Drawer' },
  { key: 'box', name: 'Box' },
  { key: 'bin', name: 'Bin / bag' },
  { key: 'device', name: 'Device' },
  { key: 'system', name: 'System' },
] as const;
