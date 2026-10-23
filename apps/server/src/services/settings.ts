import { LabSettings } from '@ixfwms/domain';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { nowIso } from '../lib/ids.js';
import { audit, requireScope, type Actor } from './context.js';

/** Lab-wide settings changed in the app, each stored under its own key, with defaults for the rest. */
export class SettingsService {
  constructor(private readonly db: Db) {}

  async get(): Promise<LabSettings> {
    const rows = await this.db.select().from(settings).all();
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
    const who = requireScope(actor, 'write');
    const valid = LabSettings.partial().parse(patch);
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
}
