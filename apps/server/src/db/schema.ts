import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  AttachmentKind,
  MapKind,
  AttributeField,
  IdentifierKind,
  LocationKind,
  MeasureUnit,
  MovementReason,
  PartStatus,
  Scope,
  StockLevel,
  StockMode,
  UserRole,
} from '@ixfwms/domain';

/*
 * SQLite schema. Kept to portable column types (text, integer, real, json-as-text)
 * so a Postgres variant stays a mechanical translation.
 * Timestamps are ISO-8601 strings in UTC.
 */

const id = () => text('id').primaryKey();
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const updatedAt = () =>
  text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull().unique(),
  role: text('role').$type<UserRole>().notNull().default('member'),
  /** scrypt hash for web login; null for users that only use API tokens. */
  passwordHash: text('password_hash'),
  createdAt: createdAt(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes', { mode: 'json' }).$type<Scope[]>().notNull(),
  /** `api` tokens are created by admins; `session` tokens come from web logins and expire. */
  kind: text('kind').$type<'api' | 'session'>().notNull().default('api'),
  expiresAt: text('expires_at'),
  createdAt: createdAt(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
});

export const locationTypes = sqliteTable('location_types', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  /** Containers that get carried around; left out of addresses. */
  movable: integer('movable', { mode: 'boolean' }).notNull().default(false),
});

export const locations = sqliteTable(
  'locations',
  {
    id: id(),
    code: text('code').notNull().unique(),
    parentId: text('parent_id'),
    typeId: text('type_id')
      .notNull()
      .references(() => locationTypes.id),
    kind: text('kind').$type<LocationKind>().notNull().default('normal'),
    name: text('name').notNull(),
    /** For the address ("A" in "Robolab-A-C"); null = guessed from the name. */
    shortName: text('short_name'),
    description: text('description'),
    /** Materialised path of ids, e.g. "/a/b/c/" (includes this location), for subtree queries. */
    path: text('path').notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('locations_parent_idx').on(t.parentId), index('locations_path_idx').on(t.path)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    /** Full path like "Pneumatics/Vacuum/Suction cups", unique. */
    path: text('path').notNull().unique(),
    /** This category's own fields; sub-categories inherit them (see effectiveFields). */
    attributeTemplate: text('attribute_template', { mode: 'json' }).$type<AttributeField[]>(),
    eclassCode: text('eclass_code'),
    etimClass: text('etim_class'),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const parts = sqliteTable(
  'parts',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: text('category_id').references(() => categories.id),
    manufacturer: text('manufacturer'),
    unitMassG: real('unit_mass_g'),
    minStock: real('min_stock'),
    attributes: text('attributes', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    notes: text('notes'),
    source: text('source'),
    status: text('status').$type<PartStatus>().notNull().default('draft'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('parts_status_idx').on(t.status), index('parts_category_idx').on(t.categoryId)],
);

export const partIdentifiers = sqliteTable(
  'part_identifiers',
  {
    id: id(),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<IdentifierKind>().notNull(),
    value: text('value').notNull(),
    valueNormalised: text('value_normalised').notNull(),
    source: text('source'),
  },
  (t) => [
    index('part_identifiers_norm_idx').on(t.valueNormalised),
    uniqueIndex('part_identifiers_unique').on(t.partId, t.kind, t.valueNormalised),
  ],
);

export const tags = sqliteTable('tags', {
  id: id(),
  name: text('name').notNull().unique(),
  color: text('color'),
});

export const partTags = sqliteTable(
  'part_tags',
  {
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.partId, t.tagId] })],
);

export const stockLots = sqliteTable(
  'stock_lots',
  {
    id: id(),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    mode: text('mode').$type<StockMode>().notNull(),
    quantity: real('quantity'),
    unit: text('unit').$type<MeasureUnit>(),
    level: text('level').$type<StockLevel>(),
    tareG: real('tare_g'),
    note: text('note'),
    lastCheckedAt: text('last_checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('stock_lots_part_idx').on(t.partId),
    index('stock_lots_location_idx').on(t.locationId),
  ],
);

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id),
    lotId: text('lot_id'),
    fromLocationId: text('from_location_id'),
    toLocationId: text('to_location_id'),
    reason: text('reason').$type<MovementReason>().notNull(),
    /** Change in the lot's quantity (null for level-tracked lots). */
    delta: real('delta'),
    /** Snapshot of the lot after the change, for history and undo. */
    after: text('after', { mode: 'json' }).$type<Record<string, unknown>>(),
    note: text('note'),
    userId: text('user_id').references(() => users.id),
    at: createdAt(),
  },
  (t) => [index('stock_movements_part_idx').on(t.partId), index('stock_movements_at_idx').on(t.at)],
);

export const locationMoves = sqliteTable(
  'location_moves',
  {
    id: id(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    fromParentId: text('from_parent_id'),
    toParentId: text('to_parent_id'),
    userId: text('user_id').references(() => users.id),
    at: createdAt(),
  },
  (t) => [index('location_moves_location_idx').on(t.locationId)],
);

export const files = sqliteTable('files', {
  id: id(),
  sha256: text('sha256').notNull().unique(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const attachments = sqliteTable(
  'attachments',
  {
    id: id(),
    ownerType: text('owner_type').$type<'part' | 'location'>().notNull(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').$type<AttachmentKind>().notNull(),
    fileId: text('file_id').references(() => files.id),
    url: text('url'),
    title: text('title'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_owner_idx').on(t.ownerType, t.ownerId)],
);

/** Generic change log for edits that aren't stock or location moves. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    userId: text('user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    at: createdAt(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId)],
);

/** Codes printed on blank labels ahead of time; claimed when a place is created with one. */
export const codeReservations = sqliteTable('code_reservations', {
  code: text('code').primaryKey(),
  /** One "reserve blank labels" run; lets a lost printout be downloaded again. */
  batchId: text('batch_id'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
  claimedAt: text('claimed_at'),
  /** Taken out of use (lost, misplaced, replaced): never handed out again, and scanning it says so. */
  retiredAt: text('retired_at'),
  /** What the code was, e.g. "was place Box: vacuum parts". */
  note: text('note'),
});

/** Saved spreadsheet column mappings, so the same export format imports with one click next time. */
export const importMappings = sqliteTable('import_mappings', {
  name: text('name').primaryKey(),
  mapping: text('mapping', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

/**
 * A map drawing (SVG) or model (.glb), drawn once and usable for many places: one cabinet drawing
 * can serve all identical cabinets. Replacing its file updates every place that uses it.
 */
export const mapDrawings = sqliteTable('map_drawings', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').$type<MapKind>().notNull(),
  fileId: text('file_id')
    .notNull()
    .references(() => files.id),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A place shown with a drawing (at most one 2D and one 3D per place). */
export const mapUsages = sqliteTable(
  'map_usages',
  {
    id: id(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    drawingId: text('drawing_id')
      .notNull()
      .references(() => mapDrawings.id),
    kind: text('kind').$type<MapKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('map_usages_unique').on(t.locationId, t.kind)],
);

/**
 * Which shape (SVG element id, or 3D object name) stands for which place, set by clicking in the app.
 * Per usage, so the same cabinet drawing links to each cabinet's own shelves.
 */
export const mapLinks = sqliteTable(
  'map_links',
  {
    id: id(),
    usageId: text('usage_id')
      .notNull()
      .references(() => mapUsages.id, { onDelete: 'cascade' }),
    elementKey: text('element_key').notNull(),
    targetId: text('target_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('map_links_element').on(t.usageId, t.elementKey),
    uniqueIndex('map_links_target').on(t.usageId, t.targetId),
  ],
);
