import type { ErrorKey, ErrorParams } from './errors.js';
/*
 * Shapes the REST API returns. Shared by the server (which produces them)
 * and the web app (which consumes them), so both sides stay in sync.
 */
import type { AttributeField } from './attributes.js';
import type {
  AttachmentKind,
  LocationKind,
  PartKind,
  SearchKind,
  PartStatus,
  ReportKind,
  Scope,
  TrackingMode,
  UnitEventKind,
  UnitStatus,
  UserRole,
} from './enums.js';
import type { BuildBrief } from './builds.js';
import type { CutShape } from './cut.js';
import type { StockAmount } from './quantity.js';

export interface LocationSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  kind: LocationKind;
  /** Short name as set, or null when it's guessed from the name. */
  shortName: string | null;
  /** Short name in use, e.g. "C": set, or guessed for fixed places; "" for a container without one. */
  short: string;
  /** Containers (boxes, bins, pallets) move around and aren't part of addresses. */
  movable: boolean;
  /** "Robolab-A-C" for a fixed place; a movable one's is just its short name. */
  address: string;
  /** Address of the fixed place this is in ("Robolab-A"), or "" at the top. */
  within: string;
  /** Temporary places: expected stay in days (null = not temporary), when that runs out, and
   *  whether it has (no stock in or out, no move, nobody said it's still needed). */
  stayDays: number | null;
  dueAt: string | null;
  overdue: boolean;
  /** A workstation (table): anyone may bring things here, and it can be cleared in one go. */
  workstation: boolean;
  /** A build: a thing made from parts (its type is a build type). */
  build: boolean;
  /** The build this place is, or is inside: what's here is built in, not free stock. */
  inBuild: { code: string; name: string } | null;
  /** When a build was taken apart; nothing can be put in it after that. */
  dismantledAt: string | null;
  /** An old container put away: hidden from lists and pickers, nothing can go in it. */
  archivedAt: string | null;
  /** "Out of the lab" itself, or inside a container lent out: nothing goes in or out. */
  outOfLab: boolean;
}

/** A temporary place left untouched longer than expected. */
export interface OverduePlace {
  place: LocationSummary;
  path: LocationSummary[];
  contact: string | null;
  lastActivityAt: string;
}

/** Server settings from the environment, shown read-only to admins. */
export interface SystemInfo {
  version: string;
  publicUrl: string | null;
  dataDir: string;
  backupHour: number;
  backupKeep: number;
  maxUploadMb: number;
  node: string;
}

export interface LocationTypeInfo {
  key: string;
  name: string;
  movable: boolean;
  /** Places of this type are temporary, expected to stay at most this many days. */
  stayDays: number | null;
  workstation: boolean;
  build: boolean;
  sort: number;
  /** How many places are of this type (a type in use can't be removed). */
  places: number;
}

export interface LocationNode extends LocationSummary {
  children: LocationNode[];
}

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  title: string | null;
  /** External URL, or a server-relative download path for uploaded files. */
  href: string;
  file: { id: string; filename: string; mime: string; size: number } | null;
}

export interface LotView {
  id: string;
  partId: string;
  amount: StockAmount;
  display: string;
  estimatedCount: number | null;
  note: string | null;
  lastCheckedAt: string | null;
  location: LocationSummary;
  path: LocationSummary[];
  /** Where it belongs back to, while it's at a workstation, a temporary place or being carried. */
  origin: { code: string; name: string } | null;
}

export interface PartSummary {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  status: PartStatus;
  kind: PartKind;
  tracking: TrackingMode;
  /** Cut stock: by length or as sheets. */
  cut: CutShape | null;
  aliases: string[];
  /** Individually tracked items: their units. */
  units: UnitBrief[];
  category: string | null;
  identifiers: { kind: string; value: string }[];
  tags: string[];
  stock: { display: string; location: string; locationCode: string; place: LocationSummary }[];
}

export interface MovementView {
  at: string;
  reason: string;
  delta: number | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  note: string | null;
}

export interface PartDetail extends PartSummary {
  description: string | null;
  unitMassG: number | null;
  minStock: number | null;
  attributes: Record<string, unknown>;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  lots: LotView[];
  attachments: AttachmentView[];
  history: MovementView[];
  /** The category's fields (inherited ones included), to label the values in `attributes`. */
  fields: AttributeField[];
}

export interface SimilarPart extends PartSummary {
  score: number;
  reason: string;
}

/** One individually tracked thing, as shown in lists. */
export interface UnitBrief {
  id: string;
  code: string;
  /** Own name, or the item's name with the code ("Impact drill A3F9"). */
  name: string;
  ownName: string | null;
  serialNo: string | null;
  status: UnitStatus;
  location: LocationSummary;
  home: LocationSummary | null;
  /** At its home place or somewhere inside it. */
  atHome: boolean;
  loan: LoanView | null;
  /** When it last moved or had a log entry. */
  lastSeenAt: string;
}

export interface UnitEventView {
  id: string;
  kind: UnitEventKind;
  text: string | null;
  value: string | null;
  from: LocationSummary | null;
  to: LocationSummary | null;
  /** User name, or the name someone without an account gave (then `guest` is true). */
  by: string | null;
  guest: boolean;
  at: string;
}

/** A unit or a whole container (`place`, with everything in it) lent out of the lab. */
export interface LoanView {
  id: string;
  unit: { code: string; name: string } | null;
  place: { code: string; name: string } | null;
  /** User name; null for readers without a login. */
  responsible: string | null;
  description: string;
  outAt: string;
  dueAt: string | null;
  overdue: boolean;
  returnedAt: string | null;
  returnedBy: string | null;
}

export interface ReportView {
  id: string;
  owner: 'unit' | 'part' | 'location';
  target: { code: string; name: string };
  kind: ReportKind;
  note: string | null;
  /** User name, or the name someone without an account gave (then `guest` is true). */
  by: string | null;
  guest: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

export interface UnitDetail extends UnitBrief {
  part: { id: string; code: string; name: string; kind: PartKind; category: string | null };
  path: LocationSummary[];
  homePath: LocationSummary[];
  /** Network details; null for people who aren't logged in (see networkHidden). */
  ipAddress: string | null;
  hostname: string | null;
  macAddress: string | null;
  networkHidden: boolean;
  notes: string | null;
  nextCheckAt: string | null;
  /** The next check date has come. */
  checkDue: boolean;
  /** Latest firmware/software log entry. */
  firmware: { version: string; at: string } | null;
  createdAt: string;
  events: UnitEventView[];
  loans: LoanView[];
  /** Open problem reports. */
  reports: ReportView[];
}

/** A unit that needs someone: reported, broken, in repair, or due for a check. */
export interface UnitAttention {
  unit: UnitBrief;
  part: { code: string; name: string };
  reason: 'status' | 'check_due';
  nextCheckAt: string | null;
}

export interface NetworkEntry {
  unit: { code: string; name: string };
  part: { code: string; name: string };
  ipAddress: string | null;
  hostname: string | null;
  macAddress: string | null;
  place: string;
}

/** What Clear the bench did: what went back where, and what stayed because nobody knows where it belongs. */
export interface ClearResult {
  returned: { kind: 'unit' | 'lot'; name: string; to: LocationSummary }[];
  left: { kind: 'unit' | 'lot' | 'place'; name: string }[];
}

/** One readable answer to "where is …?", made to be read aloud. */
export interface WhereIsAnswer {
  item: { code: string; name: string; kind: SearchKind };
  unit: string | null;
  text: string;
}

export interface LocationContentItem {
  lotId: string;
  part: { id: string; code: string; name: string; status: PartStatus; manufacturer: string | null };
  display: string;
  /** Set when the part is in a sub-location rather than directly here. */
  in: LocationSummary | null;
}

export interface LocationDetail extends LocationSummary {
  description: string | null;
  path: LocationSummary[];
  children: (LocationSummary & { partCount: number })[];
  /** Archived containers here, listed apart so they can be brought back. */
  archived: LocationSummary[];
  contents: LocationContentItem[];
  /** Individually tracked things here or inside (with `in` set for the latter). */
  units: (UnitBrief & { part: { code: string; name: string }; in: LocationSummary | null })[];
  attachments: AttachmentView[];
  /** Fixed places next to this one with the same short name, so the same address. */
  clashes: LocationSummary[];
  /** Own expected stay as set: null = the type's, 0 = not temporary. */
  ownStayDays: number | null;
  /** Expected stay of the place's type, for showing what "the type's" means. */
  typeStayDays: number | null;
  contact: string | null;
  lastActivityAt: string;
  createdAt: string;
  /** Its loan, or the loan of the container it's in, while out of the lab. */
  loan: LoanView | null;
  /** Builds: everything that has been in it (parts and units), for after it's dismantled. */
  wasInIt: { kind: 'part' | 'unit'; code: string; name: string }[];
}

export interface SearchResult<T> {
  items: T[];
  total: number;
}

/** One search result, something to open: a bulk item (no unit), one unit of a tool or device, or a build. */
export type PartSearchRow = { partId: string; unitId: string | null } | { buildId: string };

/** A page of search results. `items` are the parts its rows belong to; `total` counts rows. */
export interface PartSearchResult extends SearchResult<PartSummary> {
  rows: PartSearchRow[];
  /** The builds among `rows`. */
  builds: BuildBrief[];
}

export interface SessionUser {
  name: string;
  role: UserRole;
  scopes: Scope[];
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface ServerInfo {
  name: string;
  version: string;
  baseUrl: string;
  mcpUrl: string;
  inboxCode: string;
  you: { name: string; scopes: Scope[] } | null;
}

export interface FileUpload {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  href: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  /** Key of the message in the shared catalogue (ERROR_MESSAGES), for showing it translated. */
  key?: ErrorKey;
  params?: ErrorParams;
}

export interface LabelData {
  code: string;
  kind: 'location' | 'part' | 'unit' | 'blank';
  name: string;
  /** "Robotics lab › Cabinet A › Shelf 3" (places) or the category (parts). */
  path: string;
  type: string;
  /** What the QR code encodes. */
  qr: string;
  /** Places: the address ("Robolab-A-C"; a container's short name), the fixed place's address it's
   *  in ("Robolab-A") and its own short name ("C"). Empty for parts and blank labels. */
  address: string;
  parent: string;
  short: string;
  movable: boolean;
}

export interface CodeInfo {
  code: string;
  assigned: 'location' | 'part' | 'unit' | null;
  /** Printed on a blank label but not used yet. */
  reserved: boolean;
  free: boolean;
  /** Taken out of use; the label should be thrown away. */
  retired: { at: string; note: string | null } | null;
  /** A retired code that still works: scans go here (a duplicate part's code goes to the part it was merged into). */
  forward: { kind: 'location' | 'part' | 'unit'; code: string } | null;
}

export interface LabelBatch {
  /** null for codes reserved before batches existed. */
  id: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Codes still unused (not stuck on anything registered, not retired). */
  unused: string[];
  used: number;
  retired: number;
}

export type CarriedItem =
  | {
      kind: 'lot';
      id: string;
      part: { code: string; name: string };
      display: string;
      since: string;
    }
  | { kind: 'location'; id: string; code: string; name: string; since: string }
  | { kind: 'unit'; id: string; code: string; name: string; since: string };

export interface CarryState {
  location: LocationSummary;
  items: CarriedItem[];
  /** When the oldest item was picked up; old ones are probably forgotten. */
  since: string | null;
}

/** A place with its full path of names, for pickers that search by name. */
export interface PlaceOption extends LocationSummary {
  /** Names from the top level down to this place, e.g. ["Robotics lab", "Cabinet A", "Shelf 3"]. */
  path: string[];
  /** Codes along the same path, so a picker can leave out a place and everything inside it. */
  pathCodes: string[];
}

export interface CategoryInfo {
  path: string;
  /** Parts in this category and every category below it. */
  parts: number;
  /** Parts in this category itself. */
  ownParts: number;
  /** Number of the category's own fields. */
  fields: number;
}

export interface CategoryFields {
  path: string;
  own: AttributeField[];
  /** Own fields plus those inherited from parent categories. */
  effective: AttributeField[];
}

export interface TokenInfo {
  id: string;
  name: string;
  scopes: Scope[];
  kind: 'api' | 'session';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface UserInfo {
  id: string;
  name: string;
  role: UserRole;
  hasPassword: boolean;
  createdAt: string;
  /** False when turned off: can't log in and has no tokens, but stays in the history. */
  active: boolean;
  disabledAt: string | null;
  /** Last time any of the user's tokens or sessions was used. */
  lastActiveAt: string | null;
  /** Active tokens (not revoked, not expired). */
  tokens: TokenInfo[];
}

/** One user for the admin's user page: what would stop turning them off or removing them. */
export interface UserDetail extends UserInfo {
  /** Things recorded with this user's name (changes, moves, log entries, loans…). */
  history: number;
  /** Loans out of the lab this user is responsible for. */
  openLoans: number;
  /** Things in this user's carry list. */
  carrying: number;
  /** Only users with no history can be removed; others are turned off instead. */
  canDelete: boolean;
}

/** Someone's carry list, for the "still being carried" reminder. */
export interface CarrySummary {
  /** Null for readers without a login. */
  user: string | null;
  location: LocationSummary;
  count: number;
  since: string;
}

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
