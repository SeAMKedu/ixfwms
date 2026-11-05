import { createReadStream } from 'node:fs';
import { AttachInput } from '@ixfwms/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/errors.js';
import { requireScope } from '../../lib/context.js';
import { parse, type AppDeps } from '../context.js';

export function registerFileRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { files } = services;

  /** Multipart upload, field name "file". Identical content is stored once. */
  app.post('/api/files', async (request, reply) => {
    requireScope(request.actor, 'inventory');
    const part = await request.file();
    if (!part) throw fail('invalid', 'files.notMultipart');
    const row = await files.store(
      part.file,
      { filename: part.filename, mime: part.mimetype },
      request.actor,
    );
    if (part.file.truncated) throw fail('invalid', 'files.tooLarge');
    return reply.status(201).send({
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      href: `/api/files/${row.id}/${encodeURIComponent(row.filename)}`,
    });
  });

  const download = async (id: string, reply: FastifyReply) => {
    const { row, path } = await files.get(id);
    // SVG/HTML/XML can carry scripts; opened directly they must not run on this origin.
    if (/svg|html|xml/i.test(row.mime)) {
      reply.header(
        'content-security-policy',
        "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      );
    }
    return reply
      .header('content-type', row.mime)
      .header('content-length', row.size)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  };
  app.get('/api/files/:id', async (request, reply) =>
    download(parse(z.object({ id: z.string() }), request.params).id, reply),
  );
  app.get('/api/files/:id/:name', async (request, reply) =>
    download(parse(z.object({ id: z.string(), name: z.string() }), request.params).id, reply),
  );

  app.post('/api/attachments', async (request, reply) => {
    const view = await files.attach(parse(AttachInput, request.body), request.actor);
    return reply.status(201).send(view);
  });
}
