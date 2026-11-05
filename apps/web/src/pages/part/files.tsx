import { ATTACHMENT_KINDS, type AttachmentKind, type PartDetail } from '@ixfwms/domain';
import { ExternalLink, FileText, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAttach, useUpload } from '../../api/files';
import { Button, Card, ErrorBox, Field, Pill, Select, TextInput } from '../../components/ui';
import { formatBytes } from '../../lib/format';

export function Files({ part, canEdit }: { part: PartDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>('photo');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const upload = useUpload();
  const attach = useAttach();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const uploaded = await upload.mutateAsync(file);
    const guess: AttachmentKind = file.type.startsWith('image/')
      ? 'photo'
      : /\.(step|stp|stl|3mf|glb|iges?)$/i.test(file.name)
        ? 'model'
        : file.type === 'application/pdf'
          ? 'datasheet'
          : kind;
    await attach.mutateAsync({
      owner: 'part',
      ref: part.code,
      kind: guess,
      fileId: uploaded.id,
      title: file.name,
    });
    if (fileInput.current) fileInput.current.value = '';
  };
  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    await attach.mutateAsync({ owner: 'part', ref: part.code, kind, url, title: title || null });
    setUrl('');
    setTitle('');
    setLinkOpen(false);
  };

  return (
    <Card title={t('part.files')}>
      {part.attachments.length === 0 ? (
        <span className="text-sm text-muted">{t('part.noFiles')}</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {part.attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <a
                href={a.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline"
              >
                {a.file ? (
                  <FileText className="size-4 shrink-0" aria-hidden />
                ) : (
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                )}
                <span className="truncate">{a.title ?? a.file?.filename ?? a.href}</span>
              </a>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                {a.file && formatBytes(a.file.size)}
                <Pill>{t(`attachmentKinds.${a.kind}`)}</Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              id="part-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button
              small
              onClick={() => fileInput.current?.click()}
              busy={upload.isPending || (attach.isPending && !linkOpen)}
            >
              <Upload className="size-4" aria-hidden />
              {upload.isPending ? t('part.uploading') : t('part.uploadFile')}
            </Button>
            <Button
              small
              variant={linkOpen ? 'dark' : 'secondary'}
              onClick={() => setLinkOpen((o) => !o)}
            >
              {t('part.addLink')}
            </Button>
          </div>
          {linkOpen && (
            <form
              onSubmit={(e) => void addLink(e)}
              className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            >
              <Field label={t('part.linkUrl')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('part.linkTitle')} hint={t('common.optional')}>
                  {(id) => (
                    <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} />
                  )}
                </Field>
                <Field label={t('part.attachmentKind')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={kind}
                      onChange={(e) => setKind(e.target.value as AttachmentKind)}
                    >
                      {ATTACHMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`attachmentKinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" busy={attach.isPending}>
                  {t('common.add')}
                </Button>
                <Button onClick={() => setLinkOpen(false)}>{t('common.cancel')}</Button>
              </div>
            </form>
          )}
          <ErrorBox error={upload.error ?? attach.error} />
        </>
      )}
    </Card>
  );
}
