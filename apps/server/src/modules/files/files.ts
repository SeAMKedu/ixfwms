import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { AttachInput, AttachmentView } from '@ixfwms/domain';
import { and, asc, eq } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../../db/client.js';
import { attachments, files } from '../../db/schema.js';
import { invalid, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { audit, requireScope, type Actor } from '../../lib/context.js';
import type { PlaceStore } from '../locations/store.js';
import type { PartResolver } from '../parts/parts.js';

export type FileRow = typeof files.$inferSelect;

/** Stores uploaded files content-addressed (by SHA-256) under `<dataDir>/files`. */
export class FileService {
  constructor(
    private readonly db: Db,
    private readonly filesDir: string,
    private readonly locations: PlaceStore,
    private readonly parts: PartResolver,
  ) {}

  async store(
    content: Readable | Buffer,
    meta: { filename: string; mime: string },
    actor: Actor | null,
  ): Promise<FileRow> {
    const who = requireScope(actor, 'inventory');
    const tmpDir = join(this.filesDir, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, newId());
    const hash = createHash('sha256');
    let size = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        size += chunk.length;
        done(null, chunk);
      },
    });
    const source = Buffer.isBuffer(content) ? Readable.from([content]) : content;
    try {
      await pipeline(source, tap, createWriteStream(tmp));
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const sha256 = hash.digest('hex');
    const existing = await one(this.db.select().from(files).where(eq(files.sha256, sha256)));
    if (existing) {
      await rm(tmp, { force: true });
      return existing;
    }
    const target = this.pathFor(sha256);
    await mkdir(join(target, '..'), { recursive: true });
    await rename(tmp, target);
    const row = {
      id: newId(),
      sha256,
      filename: sanitizeFilename(meta.filename),
      mime: meta.mime || 'application/octet-stream',
      size,
      createdBy: who.userId,
    };
    await this.db.insert(files).values(row);
    return (await one(this.db.select().from(files).where(eq(files.id, row.id))))!;
  }

  async get(id: string): Promise<{ row: FileRow; path: string }> {
    const row = await one(this.db.select().from(files).where(eq(files.id, id)));
    if (!row) throw notFound('file', id);
    const path = this.pathFor(row.sha256);
    await stat(path).catch(() => {
      throw notFound('fileContent', id);
    });
    return { row, path };
  }

  async attach(input: AttachInput, actor: Actor | null): Promise<AttachmentView> {
    const who = requireScope(actor, 'inventory');
    const ownerId =
      input.owner === 'part'
        ? (await this.parts.resolve(input.ref)).id
        : (await this.locations.resolve(input.ref)).id;
    if (input.fileId) {
      const file = await one(this.db.select().from(files).where(eq(files.id, input.fileId)));
      if (!file) throw invalid('files.noUpload', { id: input.fileId });
    }
    const id = newId();
    await this.db.insert(attachments).values({
      id,
      ownerType: input.owner,
      ownerId,
      kind: input.kind,
      fileId: input.fileId ?? null,
      url: input.url ?? null,
      title: input.title ?? null,
      createdBy: who.userId,
    });
    await audit(this.db, who, 'attach', input.owner, ownerId, {
      attachmentId: id,
      kind: input.kind,
    });
    const [view] = await this.attachmentsOf(input.owner, ownerId, this.db, id);
    return view!;
  }

  async attachmentsOf(
    ownerType: 'part' | 'location',
    ownerId: string,
    ex: Executor = this.db,
    onlyId?: string,
  ): Promise<AttachmentView[]> {
    const rows = await many(
      ex
        .select({ a: attachments, f: files })
        .from(attachments)
        .leftJoin(files, eq(files.id, attachments.fileId))
        .where(
          and(
            eq(attachments.ownerType, ownerType),
            eq(attachments.ownerId, ownerId),
            onlyId ? eq(attachments.id, onlyId) : undefined,
          ),
        )
        .orderBy(asc(attachments.createdAt)),
    );
    return rows.map(({ a, f }) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      href: f ? `/api/files/${f.id}/${encodeURIComponent(f.filename)}` : (a.url ?? ''),
      file: f ? { id: f.id, filename: f.filename, mime: f.mime, size: f.size } : null,
    }));
  }

  private pathFor(sha256: string): string {
    return join(this.filesDir, sha256.slice(0, 2), sha256);
  }
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim();
  return cleaned.slice(0, 200) || 'file';
}
