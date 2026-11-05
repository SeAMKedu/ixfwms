import {
  effectiveFields,
  STARTER_CATEGORIES,
  type AttributeField,
  type CategoryFields,
  type CategoryInfo,
  fold,
} from '@ixfwms/domain';
import { asc, eq, or, sql } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../../db/client.js';
import { categories, parts } from '../../db/schema.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';

type CategoryRow = typeof categories.$inferSelect;

/** "Pneumatics / Vacuum/" → ["Pneumatics", "Vacuum"]. */
function splitPath(path: string): string[] {
  return path
    .split('/')
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Rows strictly below `path`: "A/B" matches "A/B/C", not "A/B" or "A/BC". No LIKE, so % and _ in names are safe. */
const below = (path: string) =>
  sql`substr(${categories.path}, 1, ${path.length + 1}) = ${`${path}/`}`;

/** The category at `path` (as stored) and everything below it. */
export const withinCategory = (path: string) => or(eq(categories.path, path), below(path))!;

/**
 * Part categories: a tree stored as paths ("Pneumatics/Vacuum/Suction cups"), each with the
 * fields its parts fill in. Parts point at a category by id, so renaming or moving one keeps
 * its parts.
 */
export class CategoryService {
  constructor(private readonly db: Db) {}

  /** Returns the id of the category at `path` ("Pneumatics/Vacuum"), creating missing levels. */
  async ensure(ex: Executor, path: string): Promise<string> {
    let parentId: string | null = null;
    let current = '';
    for (const name of splitPath(path)) {
      current = current ? `${current}/${name}` : name;
      const existing = await this.lookup(current, ex);
      if (existing) {
        parentId = existing.id;
        current = existing.path;
        continue;
      }
      const id = newId();
      await ex.insert(categories).values({ id, parentId, name, path: current });
      parentId = id;
    }
    if (!parentId) throw invalid('categories.emptyPath');
    return parentId;
  }

  /** Every category with its parts: `parts` counts everything below it too, `ownParts` only its own. */
  async list(): Promise<CategoryInfo[]> {
    const rows = await many(this.db.select().from(categories).orderBy(asc(categories.path)));
    const counts = await many(
      this.db
        .select({ path: categories.path, n: sql<number>`count(*)` })
        .from(parts)
        .innerJoin(categories, eq(categories.id, parts.categoryId))
        .groupBy(categories.id),
    );
    return rows.map((r) => {
      let own = 0;
      let all = 0;
      for (const c of counts) {
        if (c.path === r.path) own = Number(c.n);
        if (c.path === r.path || c.path.startsWith(`${r.path}/`)) all += Number(c.n);
      }
      return { path: r.path, parts: all, ownParts: own, fields: r.attributeTemplate?.length ?? 0 };
    });
  }

  /** A category's fields, own and inherited. Unknown paths have none. */
  async fields(path: string, ex: Executor = this.db): Promise<CategoryFields> {
    const names = splitPath(path);
    const chain: (AttributeField[] | null)[] = [];
    let own: AttributeField[] = [];
    let current = '';
    let canonical = names.join('/');
    for (const name of names) {
      current = current ? `${current}/${name}` : name;
      const row = await this.lookup(current, ex);
      chain.push(row?.attributeTemplate ?? null);
      if (row && current.length === canonical.length) {
        own = row.attributeTemplate ?? [];
        canonical = row.path;
      }
    }
    return { path: canonical, own, effective: effectiveFields(chain) };
  }

  /** Replaces a category's own fields (creating the category if needed). */
  async setFields(
    path: string,
    fields: AttributeField[],
    actor: Actor | null,
  ): Promise<CategoryFields> {
    const who = requireScope(actor, 'write');
    const keys = new Set<string>();
    for (const f of fields) {
      if (keys.has(f.key)) throw invalid('categories.keyTwice', { key: f.key });
      keys.add(f.key);
    }
    await this.db.transaction(async (tx) => {
      const id = await this.ensure(tx, path);
      await tx.update(categories).set({ attributeTemplate: fields }).where(eq(categories.id, id));
      await audit(tx, who, 'fields', 'category', id, { path, fields: fields.map((f) => f.key) });
    });
    return this.fields(path);
  }

  /** Adds the starter categories and their fields; existing fields are left alone. Returns the categories changed. */
  async seedStarter(actor: Actor | null): Promise<string[]> {
    requireScope(actor, 'write');
    const changed: string[] = [];
    for (const [path, fields] of Object.entries(STARTER_CATEGORIES)) {
      const current = await this.fields(path);
      if (current.own.length === 0) {
        await this.setFields(path, fields, actor);
        changed.push(path);
      }
    }
    return changed;
  }

  /**
   * Renames or moves a category with everything below it: "Pneumatcs" to "Pneumatics", or
   * "Suction cups" to "Pneumatics/Vacuum/Suction cups" (missing levels are created). Returns
   * the new path. Into an existing category it refuses; delete this one and move its parts
   * there instead.
   */
  async move(from: string, to: string, actor: Actor | null): Promise<string> {
    const who = requireScope(actor, 'write');
    const target = splitPath(to);
    const name = target.at(-1);
    if (!name) throw invalid('categories.giveName');
    return this.db.transaction(async (tx) => {
      const row = await this.find(tx, from);
      const wanted = fold(target.join('/'));
      const old = fold(row.path);
      if (wanted.startsWith(`${old}/`)) throw invalid('categories.insideItself');
      if (wanted !== old && (await this.lookup(wanted, tx)))
        throw conflict('categories.exists', { path: target.join('/') });

      const parentId =
        target.length > 1 ? await this.ensure(tx, target.slice(0, -1).join('/')) : null;
      const parent = parentId
        ? await one(tx.select().from(categories).where(eq(categories.id, parentId)))
        : undefined;
      const path = parent ? `${parent.path}/${name}` : name;
      if (path === row.path) return path;

      await tx.update(categories).set({ name, parentId, path }).where(eq(categories.id, row.id));
      await tx
        .update(categories)
        .set({ path: sql`${path} || substr(${categories.path}, ${row.path.length + 1})` })
        .where(below(row.path));
      await audit(tx, who, 'move', 'category', row.id, { from: row.path, to: path });
      return path;
    });
  }

  /**
   * Deletes a category that has no sub-categories. Its parts go to `moveTo` (created if
   * missing); a category with parts and nowhere to put them is refused. Returns the parts moved.
   */
  async remove(path: string, moveTo: string | null, actor: Actor | null): Promise<number> {
    const who = requireScope(actor, 'write');
    return this.db.transaction(async (tx) => {
      const row = await this.find(tx, path);
      if (await one(tx.select().from(categories).where(below(row.path))))
        throw invalid('categories.hasChildren', { path: row.path });
      const count = await tx.$count(parts, eq(parts.categoryId, row.id));
      let targetId: string | null = null;
      if (count > 0) {
        if (!moveTo?.trim()) throw invalid('categories.whereParts', { path: row.path, count });
        if (fold(splitPath(moveTo).join('/')) === fold(row.path))
          throw invalid('categories.pickAnother');
        targetId = await this.ensure(tx, moveTo);
        await tx
          .update(parts)
          .set({ categoryId: targetId, updatedAt: nowIso() })
          .where(eq(parts.categoryId, row.id));
      }
      await tx.delete(categories).where(eq(categories.id, row.id));
      await audit(tx, who, 'delete', 'category', row.id, {
        path: row.path,
        movedParts: count,
        to: targetId ? moveTo : null,
      });
      return count;
    });
  }

  /**
   * The category at `path`, matched without regard to case ("pneumatics / vacuum"). Compared
   * folded in JavaScript, since SQL lower() in SQLite folds only A–Z; there are few categories.
   */
  async lookup(path: string, ex: Executor = this.db): Promise<CategoryRow | undefined> {
    const wanted = fold(splitPath(path).join('/'));
    return (await many(ex.select().from(categories))).find((c) => fold(c.path) === wanted);
  }

  private async find(ex: Executor, path: string): Promise<CategoryRow> {
    const row = await this.lookup(path, ex);
    if (!row) throw notFound('category', path);
    return row;
  }
}
