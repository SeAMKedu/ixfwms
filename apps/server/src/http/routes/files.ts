import { createReadStream } from 'node:fs';
import { AttachInput } from '@ixfwms/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireScope } from '../../services/context.js';
import { parse, type AppDeps } from '../context.js';

export function registerFileRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { files } = services;

  /** Multipart upload, field name "file". Identical content is stored once. */
  app.post('/api/files', async (request, reply) => {
    requireScope(request.actor, 'inventory');
    const part = await request.file();
    if (!part)
      throw new AppError('invalid', 'Send the file as multipart/form-data in a field named "file"');
    const row = await files.store(
      part.file,
      { filename: part.filename, mime: part.mimetype },
      request.actor,
    );
    if (part.file.truncated) throw new AppError('invalid', 'File is larger than the upload limit');
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
    return reply
      .header('content-type', row.mime)
      .header('content-length', row.size)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
      .header('cache-control', 'public, max-age=31536000, immutable')
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
