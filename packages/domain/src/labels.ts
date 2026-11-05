/* Label sheets and the codes printed on them. */

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
