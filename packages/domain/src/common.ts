import { z } from 'zod';
import type { ErrorKey, ErrorParams } from './errors.js';

/* Building blocks the other request schemas and API shapes share. */

/** A location or part reference: internal id or short code. */
export const RefSchema = z.string().trim().min(1).max(64);

/** A place's short name for its address, e.g. "A" for Cabinet A; empty means guess it from the name. */
/** Expected stay of a temporary place in days: null = as its type says, 0 = not temporary. */
export const StayDaysSchema = z
  .number()
  .int()
  .min(0)
  .max(3650)
  .nullish()
  .describe('Temporary place: expected stay in days; 0 = not temporary, null = as its type says');

/** A calendar date, "2026-11-30". */
export const DateSchema = z.iso.date();

export interface SearchResult<T> {
  items: T[];
  total: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  /** Key of the message in the shared catalogue (ERROR_MESSAGES), for showing it translated. */
  key?: ErrorKey;
  params?: ErrorParams;
}

/** The name someone without an account gives (optional), e.g. "Pekka". */
export const ReporterName = z.string().trim().max(80).nullish();
