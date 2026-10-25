import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorBox } from './ui';

/**
 * Delete, for things made by mistake: the first press arms it ("Press again to delete") for a
 * few seconds, the second deletes. The server says why when something can't go.
 */
export function DeleteButton({
  hint,
  onDelete,
}: {
  /** What deleting does and when it can't, shown under the button. */
  hint: string;
  onDelete: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const press = async () => {
    if (!armed) {
      setError(null);
      return setArmed(true);
    }
    setBusy(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err);
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={armed ? 'danger' : 'secondary'}
        className="self-start"
        busy={busy}
        onClick={() => void press()}
      >
        <Trash2 className="size-4" aria-hidden />
        {armed ? t('delete.again') : t('delete.delete')}
      </Button>
      <p className="max-w-prose text-[12.5px] text-muted">{hint}</p>
      <ErrorBox error={error} />
    </div>
  );
}
