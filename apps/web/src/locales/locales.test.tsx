import { describe, expect, it } from 'vitest';
import en from './en.json';
import fi from './fi.json';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`),
  );
}

function placeholders(tree: Tree, prefix = ''): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === 'string'
        ? [[prefix + k, [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort()]]
        : Object.entries(placeholders(v, `${prefix}${k}.`)),
    ),
  );
}

describe('translations', () => {
  it('Finnish has exactly the English keys', () => {
    expect(keys(fi as Tree).sort()).toEqual(keys(en as Tree).sort());
  });

  it('keeps the same {{placeholders}} in every string', () => {
    expect(placeholders(fi as Tree)).toEqual(placeholders(en as Tree));
  });
});
