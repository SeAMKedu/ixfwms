/*
 * Place addresses: fixed places (rooms, cabinets, shelves) get a short address made of their
 * short names, e.g. "Robolab-A-C". Movable containers (boxes, bins, pallets) aren't part of it:
 * they're known by their name and short name, and shown at the address of where they are.
 */

import { z } from 'zod';

export const ADDRESS_SEPARATOR = '-';
const MAX_AUTO_LENGTH = 8;

/** Allowed in a short name: letters, digits, "." and "_" (the separator "-" and spaces are not). */
export const SHORT_NAME_PATTERN = /^[\p{L}\p{N}._]{1,12}$/u;

export const ShortNameSchema = z
  .string()
  .trim()
  .max(12)
  .refine((s) => s === '' || SHORT_NAME_PATTERN.test(s), {
    message: 'Use letters, digits, "." or "_" (no spaces or "-")',
  })
  .transform((s) => s || null)
  .nullish()
  .describe('Short name used in the address, e.g. "A" for Cabinet A or "A140.1" for a room');

export const AddressRootSchema = z
  .boolean()
  .optional()
  .describe(
    'The address starts at this place (a lab or room): places above it stay out, and its short name must be unique among such places',
  );

/**
 * A short name guessed from a place's name when none is set:
 * "Cabinet A" → "A", "Shelf 3 · pneumatics" → "3", "A140.1" → "A140.1", "Robotics lab" → "RL".
 */
export function autoShortName(name: string): string {
  // "Shelf 3 · pneumatics", "Shelf 3 (top)": the part before a note.
  const main = name.split(/\s+[·|–—-]\s+|\s*[(,]/)[0]!.trim() || name.trim();
  const words = main.split(/\s+/).filter(Boolean);
  const clean = (s: string) => [...s].filter((c) => /[\p{L}\p{N}._]/u.test(c)).join('');
  const last = clean(words[words.length - 1] ?? '');
  // A trailing identifier: "A", "3", "C2", "AB", but not an ordinary word like "lab".
  const identifier =
    last.length > 0 &&
    last.length <= 3 &&
    (/\p{N}/u.test(last) || last.length <= 2 || last === last.toUpperCase());
  if (words.length > 1 && identifier) return last.toUpperCase();
  if (words.length === 1 && last.length > 0 && last.length <= MAX_AUTO_LENGTH) return last;
  const initials = words.map((w) => clean(w)[0] ?? '').join('');
  return (initials || clean(main).slice(0, 3) || '?').toUpperCase().slice(0, 4);
}

/** The next short name for a copy: "A" → "B", "3" → "4", "C2" → "C3", "Z" → "Z2". */
export function nextShortName(short: string): string {
  const number = /^(.*?)(\d+)$/.exec(short);
  if (number) {
    const [, head, digits] = number as unknown as [string, string, string];
    return head + String(Number(digits) + 1).padStart(digits.length, '0');
  }
  if (/^[A-Ya-y]$/.test(short)) return String.fromCharCode(short.charCodeAt(0) + 1);
  return `${short}2`;
}

export interface AddressPart {
  name: string;
  shortName: string | null;
  movable: boolean;
  addressRoot?: boolean;
}

/**
 * Address parts of a place, from the path down to it (the place last): the address of the fixed
 * places it's in (`parent`), its own short name, and its full address. The address starts at the
 * deepest address root on the way, so a building added above a lab changes nothing. A movable
 * place's address is just its short name, and only a set one (a guess from "Box: M4 screws" would
 * be noise); where it is shows separately.
 */
export function addressOf(path: AddressPart[]): { parent: string; short: string; address: string } {
  const own = path[path.length - 1];
  if (!own) return { parent: '', short: '', address: '' };
  const short = own.shortName || (own.movable ? '' : autoShortName(own.name));
  const start = path.findLastIndex((p) => p.addressRoot && !p.movable);
  const parent = path
    .slice(Math.max(start, 0), -1)
    .filter((p) => !p.movable)
    .map((p) => p.shortName || autoShortName(p.name))
    .join(ADDRESS_SEPARATOR);
  const address = own.movable || !parent ? short : `${parent}${ADDRESS_SEPARATOR}${short}`;
  return { parent, short, address };
}
