import { Archive, ArchiveRestore } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChange } from '../api/client';
import { Button, ErrorBox } from './ui';

/**
 * Archive, or Unarchive when it already is: one press either way, since it can be undone.
 * `onChange` gets true to archive, false to bring it back.
 */
export function ArchiveButton({
  archived,
  hint,
  onChange,
}: {
  archived: boolean;
  /** What archiving does, shown under the button (not once it's archived). */
  hint?: string;
  onChange: (archive: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const change = useChange(onChange);
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={archived ? 'primary' : 'secondary'}
        className="self-start"
        busy={change.isPending}
        onClick={() => change.mutate(!archived)}
      >
        {archived ? (
          <ArchiveRestore className="size-4" aria-hidden />
        ) : (
          <Archive className="size-4" aria-hidden />
        )}
        {archived ? t('archive.unarchive') : t('archive.archive')}
      </Button>
      {hint && !archived && <p className="max-w-prose text-[12.5px] text-muted">{hint}</p>}
      <ErrorBox error={change.error} />
    </div>
  );
}
