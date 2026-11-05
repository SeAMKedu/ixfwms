import { z } from 'zod';
import { RefSchema, ReporterName } from './common.js';
import { REPORT_KINDS, type ReportKind } from './enums.js';

/* Problem reports. */

export const ReportInput = z.object({
  owner: z.enum(['unit', 'part', 'location']),
  ref: RefSchema,
  kind: z.enum(REPORT_KINDS).default('broken'),
  note: z.string().trim().max(2000).nullish(),
  name: ReporterName,
});
export type ReportInput = z.infer<typeof ReportInput>;

export const ResolveReportInput = z.object({
  resolution: z.string().trim().max(2000).nullish().describe('What was done'),
});
export type ResolveReportInput = z.infer<typeof ResolveReportInput>;

export interface ReportView {
  id: string;
  owner: 'unit' | 'part' | 'location';
  target: { code: string; name: string };
  kind: ReportKind;
  note: string | null;
  /** User name, or the name someone without an account gave (then `guest` is true). */
  by: string | null;
  guest: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}
