import { isValidCode, normalizeCode } from './codes.js';
import type { LocationSummary } from './api.js';

/*
 * Lab maps are drawings made outside the app (Inkscape, Illustrator, Blender). An element whose id
 * is "loc:" + a place code (or "loc-" / "loc_", for tools that don't allow ":" in ids) stands for
 * that place. Everything else in the drawing is decoration.
 */

export const MAP_KINDS = ['svg_2d', 'gltf_3d'] as const;
export type MapKind = (typeof MAP_KINDS)[number];

const ELEMENT_ID = /^loc[:_-]([0-9a-z]{4,8})$/i;

/** The place code an element id stands for, or null. */
export function codeFromElementId(id: string): string | null {
  const m = ELEMENT_ID.exec(id.trim());
  if (!m?.[1]) return null;
  const code = normalizeCode(m[1]);
  return isValidCode(code) ? code : null;
}

/**
 * The place code a 3D object name stands for. Accepts the same forms as SVG ids, plus the forms
 * three.js turns them into when loading glTF ("loc:A3F9" becomes "locA3F9"), and ignores Blender's
 * ".001" duplicate suffixes.
 */
export function codeFromObjectName(name: string): string | null {
  const base = name.trim().replace(/\.\d{3}$/, '');
  const direct = codeFromElementId(base);
  if (direct) return direct;
  const m = /^loc([0-9a-z]{4,8})$/i.exec(base);
  if (!m?.[1]) return null;
  const code = normalizeCode(m[1]);
  return isValidCode(code) ? code : null;
}

/** Node names from a binary glTF (.glb) file's JSON chunk. Returns [] for anything that isn't a GLB. */
export function glbNodeNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return []; // "glTF"
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) return []; // "JSON"
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    nodes?: { name?: string }[];
  };
  return (json.nodes ?? []).map((n) => n.name ?? '').filter(Boolean);
}

/** Place codes named by objects in a .glb model. */
export function scanGlbCodes(bytes: Uint8Array): string[] {
  return [
    ...new Set(
      glbNodeNames(bytes)
        .map(codeFromObjectName)
        .filter((c): c is string => c !== null),
    ),
  ];
}

/** All place codes referenced by element ids in an SVG document. */
export function scanSvgCodes(svg: string): string[] {
  const codes = new Set<string>();
  for (const m of svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) {
    const code = m[1] ? codeFromElementId(m[1]) : null;
    if (code) codes.add(code);
  }
  return [...codes];
}

export interface MapCheck {
  /** Codes in the drawing that are this place's sub-places (anywhere below it). */
  linked: { code: string; name: string }[];
  /** Codes in the drawing that don't belong to a place inside this one. */
  unknown: string[];
  /** Direct sub-places that aren't drawn yet. */
  notDrawn: { code: string; name: string }[];
}

/** One drawing on the way down to a place, with the elements to highlight. */
export interface MapLayer {
  location: LocationSummary;
  kind: MapKind;
  href: string;
  /** Codes on the path below this place (e.g. the cabinet, shelf and box to light up on the lab plan). */
  highlight: string[];
}
