import { normalizeCode, type PartDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useShortcut } from '../../lib/shortcuts';
import { useMergePart, useSetStatus } from '../../api/parts';
import { useDelete } from '../../api/builds';
import { ArchiveButton } from '../../components/archive-button';
import { DeleteButton } from '../../components/delete-button';
import { Button, Card, ErrorBox, Field, TextInput } from '../../components/ui';

export function Review({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setStatus = useSetStatus(part.code);
  const merge = useMergePart(part.code);
  const remove = useDelete();
  const [target, setTarget] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  useShortcut(
    'r',
    t('shortcuts.review'),
    () => setStatus.mutate('active'),
    part.status === 'draft',
  );
  const doMerge = async (e: FormEvent) => {
    e.preventDefault();
    const kept = await merge.mutateAsync(normalizeCode(target));
    void navigate(`/p/${kept.code}`, { replace: true });
  };
  return (
    <Card
      className={part.status === 'draft' ? 'border-link/40 bg-link-soft/40' : undefined}
      title={part.status === 'draft' ? undefined : t('part.manage')}
    >
      {part.status === 'draft' && <p className="text-sm">{t('part.confirmHint')}</p>}
      {part.status === 'archived' && <p className="text-sm">{t('archive.partNote')}</p>}
      <div className="flex flex-wrap gap-2">
        {part.status === 'draft' && (
          <Button
            variant="primary"
            busy={setStatus.isPending}
            onClick={() => setStatus.mutate('active')}
          >
            {t('part.confirm')}
          </Button>
        )}
        <Button variant={mergeOpen ? 'dark' : 'secondary'} onClick={() => setMergeOpen((o) => !o)}>
          {t('part.merge')}
        </Button>
      </div>
      {mergeOpen && (
        <form onSubmit={(e) => void doMerge(e)} className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">{t('part.mergeHint')}</p>
          <Field label={t('part.mergeTarget')}>
            {(id) => (
              <TextInput
                id={id}
                required
                autoCapitalize="characters"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="font-mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" busy={merge.isPending} className="self-start">
            {t('part.merge')}
          </Button>
        </form>
      )}
      <ErrorBox error={setStatus.error ?? merge.error} />
      {part.status !== 'draft' && (
        <ArchiveButton
          archived={part.status === 'archived'}
          hint={t('archive.partHint')}
          onChange={(archive) => setStatus.mutateAsync(archive ? 'archived' : 'active')}
        />
      )}
      <DeleteButton
        hint={t('delete.partHint')}
        onDelete={async () => {
          await remove.mutateAsync(`/api/parts/${part.code}`);
          void navigate('/', { replace: true });
        }}
      />
    </Card>
  );
}
