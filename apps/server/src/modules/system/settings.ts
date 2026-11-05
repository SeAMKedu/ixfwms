import { LabSettings } from '@ixfwms/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { many, type Db } from '../../db/client.js';
import { settings, stockLots } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import { nowIso } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';

/** Lab-wide settings changed in the app, each stored under its own key, with defaults for the rest. */
export class SettingsService {
  constructor(private readonly db: Db) {}

  async get(): Promise<LabSettings> {
    const rows = await many(this.db.select().from(settings));
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // A value that no longer fits (say, after an upgrade) falls back to its default.
    const out = LabSettings.parse({});
    for (const key of Object.keys(out) as (keyof LabSettings)[]) {
      const one = LabSettings.shape[key].safeParse(stored[key]);
      if (one.success) Object.assign(out, { [key]: one.data });
    }
    return out;
  }

  async update(patch: Partial<LabSettings>, actor: Actor | null): Promise<LabSettings> {
    // What people without an account may do and see is security policy, so it's for admins.
    const policy = 'anonymousActions' in patch || 'anonymousView' in patch;
    const who = requireScope(actor, policy ? 'admin' : 'write');
    const valid = LabSettings.partial().parse(patch);
    if ('stockLevels' in patch && valid.stockLevels) await this.checkLevelsInUse(valid.stockLevels);
    for (const [key, value] of Object.entries(valid)) {
      // A partial schema fills missing keys with their defaults; store only what was given.
      if (value === undefined || !(key in patch)) continue;
      await this.db
        .insert(settings)
        .values({ key, value, updatedBy: who.userId })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedBy: who.userId, updatedAt: nowIso() },
        });
    }
    await audit(this.db, who, 'update', 'settings', 'lab', patch);
    return this.get();
  }

  /** A level some stock is at can't be removed; it would leave that stock without a meaning. */
  private async checkLevelsInUse(next: LabSettings['stockLevels']): Promise<void> {
    const keep = new Set(next.map((l) => l.key));
    const removed = (await this.get()).stockLevels.filter((l) => !keep.has(l.key));
    if (!removed.length) return;
    const used = await many(
      this.db
        .select({ level: stockLots.level })
        .from(stockLots)
        .where(
          and(
            eq(stockLots.mode, 'level'),
            inArray(
              stockLots.level,
              removed.map((l) => l.key),
            ),
          ),
        ),
    );
    const names = removed.filter((l) => used.some((u) => u.level === l.key)).map((l) => l.name);
    if (names.length) throw invalid('levels.inUse', { levels: names.join(', ') });
  }
}
