/**
 * The name after this one, for numbering copies: "Cabinet A" → "Cabinet B", "Shelf 9" → "Shelf 10",
 * "Box 07" → "Box 08", anything else "Drawer" → "Drawer 2".
 */
export function nextName(name: string): string {
  const number = /^(.*?)(\d+)$/.exec(name);
  if (number) {
    const [, head, digits] = number as unknown as [string, string, string];
    return head + String(Number(digits) + 1).padStart(digits.length, '0');
  }
  const letter = /^(.*[\s\-_])([A-Ya-y])$/.exec(name);
  if (letter) {
    const [, head, ch] = letter as unknown as [string, string, string];
    return head + String.fromCharCode(ch.charCodeAt(0) + 1);
  }
  return `${name} 2`;
}

/** The first name after `name` that isn't in `taken` (compared case-insensitively). */
export function nextFreeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  let candidate = nextName(name);
  while (used.has(candidate.toLowerCase())) candidate = nextName(candidate);
  return candidate;
}
