/*
 * Shapes the REST API returns. Shared by the server (which produces them)
 * and the web app (which consumes them), so both sides stay in sync.
 */
import type { AttributeField } from './attributes.js';
import type { AttachmentKind, LocationKind, PartStatus, Scope, UserRole } from './enums.js';
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
}

export interface LocationTypeInfo {
  key: string;
  name: string;
  movable: boolean;
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
}

export interface PartSummary {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  status: PartStatus;
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
  contents: LocationContentItem[];
  attachments: AttachmentView[];
  /** Fixed places next to this one with the same short name, so the same address. */
  clashes: LocationSummary[];
}

export interface SearchResult<T> {
  items: T[];
  total: number;
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
}

export interface LabelData {
  code: string;
  kind: 'location' | 'part' | 'blank';
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
  assigned: 'location' | 'part' | null;
  /** Printed on a blank label but not used yet. */
  reserved: boolean;
  free: boolean;
  /** Taken out of use; the label should be thrown away. */
  retired: { at: string; note: string | null } | null;
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
  | { kind: 'location'; id: string; code: string; name: string; since: string };

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
  parts: number;
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
  /** Active tokens (not revoked, not expired). */
  tokens: TokenInfo[];
}

/** Someone's carry list, for the "still being carried" reminder. */
export interface CarrySummary {
  user: string;
  location: LocationSummary;
  count: number;
  since: string;
}

export type HistoryKind = 'stock' | 'location' | 'edit';

export interface HistoryEntry {
  kind: HistoryKind;
  id: string;
  at: string;
  user: string | null;
  /** add, take, stocktake, move; location moves are "move"; edits use the audit action (create, update, merge…). */
  action: string;
  part: { code: string; name: string } | null;
  place: { code: string; name: string } | null;
  from: { code: string; name: string } | null;
  to: { code: string; name: string } | null;
  delta: number | null;
  /** Moves can be undone while nothing has changed since. */
  undoable: boolean;
}
