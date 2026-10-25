import { sql } from 'drizzle-orm';
import {
  check,
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
  CutShape,
  Piece,
  MapKind,
  AttributeField,
  IdentifierKind,
  LocationKind,
  MeasureUnit,
  MovementReason,
  PartKind,
  PartStatus,
  ReportKind,
  Scope,
  StockLevel,
  StockMode,
  TrackingMode,
  UnitEventKind,
  UnitStatus,
  UserRole,
} from '@ixfwms/domain';
import { nowIso } from '../lib/ids.js';
import { nowIsoDefault } from './dialect.js';

/*
 * SQLite schema. Kept to portable column types (text, integer, real, json-as-text) so a
 * Postgres variant stays a mechanical translation; SQL that differs lives in ./dialect.ts.
 * Timestamps are ISO-8601 strings in UTC.
 */

const id = () => text('id').primaryKey();
// The app writes timestamps (nowIso: one fixed-width form); the SQL default is for raw SQL.
const createdAt = () => text('created_at').notNull().default(nowIsoDefault).$defaultFn(nowIso);
const updatedAt = () => text('updated_at').notNull().default(nowIsoDefault).$defaultFn(nowIso);

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull().unique(),
  role: text('role').$type<UserRole>().notNull().default('member'),
  /** scrypt hash for web login; null for users that only use API tokens. */
  passwordHash: text('password_hash'),
  /** Turned off: can't log in, tokens revoked; kept so history still shows who did what. */
  disabledAt: text('disabled_at'),
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
  /** Places of this type are temporary: expected to be gone (or touched) within this many days. */
  stayDays: integer('stay_days'),
  /** Tables people bring things to: anyone may bring things here, and they can be cleared in one go. */
  workstation: integer('workstation', { mode: 'boolean' }).notNull().default(false),
  /** Things made from parts (a gripper, a test rig): what's in them isn't free stock. */
  build: integer('build', { mode: 'boolean' }).notNull().default(false),
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
    /** Expected stay in days: null = the type's, 0 = not temporary. */
    stayDays: integer('stay_days'),
    /** Who to ask about a temporary place ("whose pallet is this?"). */
    contact: text('contact'),
    /** Last time stock went in or out (here or inside), it moved, or someone said it's still needed. */
    lastActivityAt: text('last_activity_at'),
    /** A build taken apart: kept so its code still scans and what was in it can be looked up. */
    dismantledAt: text('dismantled_at'),
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
    kind: text('kind').$type<PartKind>().notNull().default('part'),
    /** bulk: stock lots; individual: units. */
    tracking: text('tracking').$type<TrackingMode>().notNull().default('bulk'),
    /** Other names people use ("impact driver"), matched by search. */
    aliases: text('aliases', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    unitMassG: real('unit_mass_g'),
    minStock: real('min_stock'),
    /** Cut stock (see cut.ts): by length or as sheets; its lots keep their pieces' sizes. */
    cut: text('cut').$type<CutShape>(),
    attributes: text('attributes', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    notes: text('notes'),
    source: text('source'),
    status: text('status').$type<PartStatus>().notNull().default('draft'),
    /** Name, description, maker and aliases folded (fold()), which search matches against. */
    searchText: text('search_text'),
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
    /** mode `cut`: the pieces in mm, [length] or [width, height] each; quantity is how many. */
    pieces: text('pieces', { mode: 'json' }).$type<Piece[]>(),
    note: text('note'),
    lastCheckedAt: text('last_checked_at'),
    /**
     * Where this stock belongs back to: the place it was moved from (past "being carried").
     * Null at home. Put back and Clear the bench use it, and lots only merge with lots from
     * the same place.
     */
    originLocationId: text('origin_location_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('stock_lots_part_idx').on(t.partId),
    index('stock_lots_location_idx').on(t.locationId),
    // One lot per part, place, kind of amount and origin.
    uniqueIndex('stock_lots_one_per_place').on(
      t.partId,
      t.locationId,
      t.mode,
      sql`coalesce(${t.unit}, '')`,
      sql`coalesce(${t.originLocationId}, '')`,
    ),
    check(
      'stock_lots_whole_count',
      sql`${t.mode} <> 'count' or ${t.quantity} = cast(${t.quantity} as integer)`,
    ),
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
    /** Name given by someone without an account. */
    reporterName: text('reporter_name'),
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

/** One individually tracked thing (a drill, a robot, a PLC CPU) of an item with tracking = individual. */
export const units = sqliteTable(
  'units',
  {
    id: id(),
    code: text('code').notNull().unique(),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id),
    name: text('name'),
    serialNo: text('serial_no'),
    /** Own name and serial number folded (fold()), which search matches against. */
    searchText: text('search_text'),
    status: text('status').$type<UnitStatus>().notNull().default('ok'),
    /** Where it is now. */
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    /** Where it belongs ("Put back" goes here). */
    homeLocationId: text('home_location_id').references(() => locations.id),
    /** Network details, shown only to people who are logged in. */
    ipAddress: text('ip_address'),
    hostname: text('hostname'),
    macAddress: text('mac_address'),
    notes: text('notes'),
    /** Next maintenance or inspection (a date, YYYY-MM-DD). */
    nextCheckAt: text('next_check_at'),
    lastSeenAt: text('last_seen_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('units_part_idx').on(t.partId),
    index('units_location_idx').on(t.locationId),
    index('units_home_idx').on(t.homeLocationId),
  ],
);

/** A unit's log: moves, notes, maintenance, firmware versions, problems, loans. */
export const unitEvents = sqliteTable(
  'unit_events',
  {
    id: id(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<UnitEventKind>().notNull(),
    text: text('text'),
    value: text('value'),
    fromLocationId: text('from_location_id'),
    toLocationId: text('to_location_id'),
    userId: text('user_id').references(() => users.id),
    /** Name given by someone without an account. */
    reporterName: text('reporter_name'),
    at: createdAt(),
  },
  (t) => [index('unit_events_unit_idx').on(t.unitId, t.at)],
);

/** A unit taken out of the lab, with the person responsible for it (who has an account). */
export const loans = sqliteTable(
  'loans',
  {
    id: id(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    responsibleUserId: text('responsible_user_id')
      .notNull()
      .references(() => users.id),
    description: text('description').notNull(),
    outAt: text('out_at').notNull().default(nowIsoDefault).$defaultFn(nowIso),
    /** Expected back (a date, YYYY-MM-DD). */
    dueAt: text('due_at'),
    returnedAt: text('returned_at'),
    returnedBy: text('returned_by').references(() => users.id),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [index('loans_unit_idx').on(t.unitId)],
);

/** "This is broken / missing parts / running low", from anyone, open until someone resolves it. */
export const reports = sqliteTable(
  'reports',
  {
    id: id(),
    ownerType: text('owner_type').$type<'unit' | 'part' | 'location'>().notNull(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').$type<ReportKind>().notNull(),
    note: text('note'),
    userId: text('user_id').references(() => users.id),
    reporterName: text('reporter_name'),
    createdAt: createdAt(),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.id),
    resolution: text('resolution'),
  },
  (t) => [
    index('reports_owner_idx').on(t.ownerType, t.ownerId),
    index('reports_open_idx').on(t.resolvedAt),
  ],
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

/**
 * Every code ever used: places, items, units, blank labels and retired codes share this one
 * namespace. Triggers on locations, parts and units (migration 0013) claim a code when a row
 * gets it and refuse one already in use or retired, so the rule holds whoever writes the row.
 */
export const codes = sqliteTable('codes', {
  code: text('code').primaryKey(),
  /** What has the code now; null for an unused blank label or a retired code. Set by the triggers. */
  ownerType: text('owner_type').$type<'location' | 'part' | 'unit'>(),
  /** Set when the code was printed on a blank label ahead of time. */
  reservedAt: text('reserved_at'),
  /** One "reserve blank labels" run; lets a lost printout be downloaded again. */
  batchId: text('batch_id'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
  /** When the code first went onto a place, item or unit. */
  claimedAt: text('claimed_at'),
  /** Taken out of use (lost, misplaced, replaced): never handed out again, and scanning it says so. */
  retiredAt: text('retired_at'),
  /** What the code was, e.g. "was place Box: vacuum parts". */
  note: text('note'),
  /** Where scans of this retired code go instead: the part a duplicate was merged into. */
  forwardTo: text('forward_to'),
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

/** Lab-wide settings changed in the app (server settings stay in the environment). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});
