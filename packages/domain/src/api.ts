/*
 * Shapes the REST API returns. Shared by the server (which produces them)
 * and the web app (which consumes them), so both sides stay in sync.
 */
import type { AttachmentKind, LocationKind, PartStatus, Scope, UserRole } from './enums.js';
import type { StockAmount } from './quantity.js';

export interface LocationSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  kind: LocationKind;
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
  stock: { display: string; location: string; locationCode: string }[];
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
}

export interface CodeInfo {
  code: string;
  assigned: 'location' | 'part' | null;
  /** Printed on a blank label but not used yet. */
  reserved: boolean;
  free: boolean;
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
