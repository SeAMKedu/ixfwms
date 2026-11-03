import { z } from 'zod';
import { NUMBER_FROM, type NumberFrom, type SearchKind } from './enums.js';

/*
 * Directions to a place, for saying where something is in words: each place's hint for finding
 * it inside its parent, and which way a parent's sub-places are numbered.
 */

/** How to find a place inside its parent, in a few words; read aloud with directions. */
export const HintSchema = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .describe(
    'How to find the place inside its parent, e.g. "Grey two-door cabinet next to the project workbench". Landmarks and looks, not contents',
  );

export const NumberFromSchema = z
  .enum(NUMBER_FROM)
  .nullish()
  .describe(
    'Which way the sub-places are numbered, e.g. "bottom" for shelves counted from the floor',
  );

/**
 * One step on the way to a place: its name, the written hint for finding it inside the step
 * before, and which one it is when its parent's sub-places are numbered ("2 of 5 from the bottom").
 */
export interface PlaceStep {
  name: string;
  type: string;
  hint?: string;
  position?: { n: number; of: number; from: NumberFrom };
}

/** One readable answer to "where is …?", made to be read aloud. */
export interface WhereIsAnswer {
  item: { code: string; name: string; kind: SearchKind };
  unit: string | null;
  text: string;
  /** How to get to the (first) place in `text`, from the top down, to say in your own words. */
  directions?: PlaceStep[];
}
