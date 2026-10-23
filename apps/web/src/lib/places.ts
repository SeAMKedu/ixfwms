import { normalizeCode, type PlaceOption } from '@ixfwms/domain';

const SEPARATORS = /\s*(?:›|>|\/)\s*/;
const MAX_RESULTS = 12;

export const placeLabel = (p: PlaceOption) => p.path.join(' › ');

/** What a place's tape chip says: a fixed place's address, a container's set short name or code. */
export const placeTag = (p: Pick<PlaceOption, 'movable' | 'address' | 'shortName' | 'code'>) =>
  p.movable ? (p.shortName ?? p.code) : p.address;

/**
 * Finds places by name or code. Typing follows the hierarchy:
 * "cab a › sh" or "cab a / sh" matches path levels in order, and plain words ("cabinet shelf 3")
 * must all appear somewhere in the path. An exact code always comes first.
 */
export function matchPlaces(options: PlaceOption[], query: string): PlaceOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, MAX_RESULTS);
  const code = normalizeCode(q);
  const segments = q.split(SEPARATORS).filter(Boolean);
  const scored: { place: PlaceOption; score: number }[] = [];

  for (const place of options) {
    const names = place.path.map((n) => n.toLowerCase());
    const own = names[names.length - 1] ?? '';
    let score: number | null = null;
    if (place.code === code) score = 0;
    else if (place.address.toLowerCase() === q) score = 1;
    else if (!place.movable && place.address.toLowerCase().startsWith(q) && q.length > 1)
      score = 5 + names.length;
    else if (segments.length > 1) {
      // Each typed level must match a path level, in order (levels may be skipped).
      if (matchesInOrder(names, segments)) {
        score = 10 + (levelMatches(own, segments[segments.length - 1]!) ? 0 : 5) + names.length;
      }
    } else {
      const words = q.split(/\s+/).filter(Boolean);
      const text = names.join(' ');
      if (words.every((w) => wordMatches(text, w))) {
        const last = words[words.length - 1]!;
        score = (own.startsWith(last) ? 20 : wordMatches(own, last) ? 25 : 40) + names.length;
      }
    }
    if (score !== null) scored.push({ place, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || placeLabel(a.place).localeCompare(placeLabel(b.place)))
    .slice(0, MAX_RESULTS)
    .map((s) => s.place);
}

/** "cab" matches "Cabinet", "3" matches "Shelf 3"; longer fragments may also match inside a word. */
function wordMatches(text: string, word: string): boolean {
  return (
    text.split(/[\s:,.()-]+/).some((w) => w.startsWith(word)) ||
    (word.length >= 3 && text.includes(word))
  );
}

/** Every word of a typed level must match its place level ("cab a" → "Cabinet A"). */
function levelMatches(name: string, segment: string): boolean {
  return segment.split(/\s+/).every((w) => wordMatches(name, w));
}

function matchesInOrder(names: string[], segments: string[]): boolean {
  let level = 0;
  for (const segment of segments) {
    while (level < names.length && !levelMatches(names[level]!, segment)) level++;
    if (level === names.length) return false;
    level++;
  }
  return true;
}
