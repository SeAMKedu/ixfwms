import type { AttachInput, AttachmentView, FileUpload } from '@ixfwms/domain';
import { api, useChange } from './client';

/** Uploading files and attaching them. */
export const useUpload = () =>
  useChange((file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api<FileUpload>('/api/files', { form });
  });
export const useAttach = () =>
  useChange((input: AttachInput) => api<AttachmentView>('/api/attachments', { body: input }));
