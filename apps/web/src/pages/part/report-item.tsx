import { REPORT_KINDS, type ReportKind, type PartDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useReport } from '../../api/queries';
import { Button, ErrorBox, Field, Select, TextArea } from '../../components/ui';
import { GuestName } from '../../components/units';

/** Anyone can report that an item is running low, has missing parts, or is broken. */
export function ReportItem({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('running_low');
  const [note, setNote] = useState('');
  const report = useReport();
  if (report.isSuccess && !open) return <p className="text-sm text-ok">{t('reports.thanks')}</p>;
  if (!open)
    return (
      <Button small variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        {t('reports.report')}
      </Button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await report.mutateAsync({ owner: 'part', ref: part.code, kind, note: note || null });
    setOpen(false);
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <Field label={t('reports.whatsWrong')}>
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`reportKinds.${k}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('reports.note')} hint={t('common.optional')}>
        {(id) => <TextArea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <GuestName />
      <ErrorBox error={report.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={report.isPending}>
          {t('reports.send')}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
