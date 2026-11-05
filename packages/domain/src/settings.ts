import { z } from 'zod';
import { ANONYMOUS_ACTIONS, ANONYMOUS_VIEWS, type Scope } from './enums.js';
import { DEFAULT_STOCK_LEVELS, LEVEL_STATES } from './quantity.js';

/* The lab's settings and what the server says about itself. */

export const StockLevelDefSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  state: z.enum(LEVEL_STATES),
});

export const LabSettings = z.object({
  /** Things carried longer than this are flagged as probably forgotten. */
  carryForgottenHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(4),
  /** Tape width the label panels start with. */
  labelTape: z.enum(['9', '12', '24']).default('12'),
  /** What people without an account may do besides looking and reporting problems. */
  anonymousActions: z.enum(ANONYMOUS_ACTIONS).default('workstation'),
  /** What people without an account see: `limited` leaves out serial numbers, notes and firmware. */
  anonymousView: z.enum(ANONYMOUS_VIEWS).default('limited'),
  /** Stock levels for stock tracked as a level, best first. */
  stockLevels: z
    .array(StockLevelDefSchema)
    .min(2)
    .max(8)
    .superRefine((levels, ctx) => {
      const keys = new Set(levels.map((l) => l.key));
      const names = new Set(levels.map((l) => l.name.toLowerCase()));
      if (keys.size < levels.length || names.size < levels.length)
        ctx.addIssue({ code: 'custom', message: 'Each level needs its own name' });
    })
    .default(DEFAULT_STOCK_LEVELS),
});
export type LabSettings = z.infer<typeof LabSettings>;

/** Server settings from the environment, shown read-only to admins. */
export interface SystemInfo {
  version: string;
  publicUrl: string | null;
  dataDir: string;
  backupHour: number;
  backupKeep: number;
  maxUploadMb: number;
  node: string;
}

export interface ServerInfo {
  name: string;
  version: string;
  baseUrl: string;
  mcpUrl: string;
  inboxCode: string;
  you: { name: string; scopes: Scope[] } | null;
}
