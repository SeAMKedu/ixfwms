import type { BomCheck } from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { Button, ErrorBox, Field, TextInput } from '../../components/ui';

/** Tags every item the parts list matched, e.g. with the project's name. */
export function TagParts({ result }: { result: BomCheck }) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [tagged, setTagged] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const tagAll = async () => {
    if (!tag.trim()) return;
    const codes = [...new Set(result.lines.flatMap((l) => (l.part ? [l.part.code] : [])))];
    setError(null);
    const res = await api<{ tagged: number }>('/api/bom/tag', {
      body: { codes, tag: tag.trim() },
    }).catch((err: unknown) => {
      setError(err);
      return null;
    });
    if (res) setTagged(res.tagged);
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('bom.tagLabel')}>
          {(id) => (
            <TextInput
              id={id}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={t('bom.tagPlaceholder')}
            />
          )}
        </Field>
        <Button onClick={() => void tagAll()} disabled={!tag.trim()}>
          {t('bom.tag')}
        </Button>
        {tagged !== null && (
          <Link to={`/items?tag=${encodeURIComponent(tag.trim())}`} className="text-sm text-link">
            {t('bom.tagged', { count: tagged })}
          </Link>
        )}
      </div>
      <ErrorBox error={error} />
    </>
  );
}
