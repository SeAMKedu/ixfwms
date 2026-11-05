import { z } from 'zod';
import { RefSchema } from './common.js';
import { ATTACHMENT_KINDS, type AttachmentKind } from './enums.js';

/* Uploaded files and attachments. */

export const AttachInput = z
  .object({
    owner: z.enum(['part', 'location']),
    ref: RefSchema,
    kind: z.enum(ATTACHMENT_KINDS).default('other'),
    fileId: z.string().trim().min(1).max(64).nullish(),
    url: z.url().max(2000).nullish(),
    title: z.string().trim().max(300).nullish(),
  })
  .refine((a) => (a.fileId == null) !== (a.url == null), { message: 'give either fileId or url' });
export type AttachInput = z.infer<typeof AttachInput>;

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  title: string | null;
  /** External URL, or a server-relative download path for uploaded files. */
  href: string;
  file: { id: string; filename: string; mime: string; size: number } | null;
}

export interface FileUpload {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  href: string;
}
