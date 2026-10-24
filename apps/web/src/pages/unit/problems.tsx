import { REPORT_KINDS, type ReportKind, type UnitDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useReport, useResolveReport } from '../../api/queries';
import { useSession } from '../../auth/session';
import { Button, Card, ErrorBox, Field, Select, TextArea, TextInput } from '../../components/ui';
import { GuestName } from '../../components/units';
import { formatDate } from '../../lib/format';
import { useShortcut } from '../../lib/shortcuts';
import { byText } from './log';

export function Problems({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('broken');
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const report = useReport();
  const resolve = useResolveReport();
  useShortcut('r', t('reports.report'), () => setOpen(true));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await report.mutateAsync({ owner: 'unit', ref: unit.code, kind, note: note || null });
    setOpen(false);
    setNote('');
  };
  const done = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolving) return;
    await resolve.mutateAsync({ id: resolving, resolution: resolution || null });
    setResolving(null);
    setResolution('');
  };
  return (
    <Card title={t('reports.title')}>
      {unit.reports.length === 0 ? (
        <span className="text-sm text-muted">{t('reports.none')}</span>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {unit.reports.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-lg bg-warn-soft/60 px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong>{t(`reportKinds.${r.kind}`)}</strong>
                <span className="text-[12px] text-muted">
                  {byText(t, r.by, r.guest)} · {formatDate(r.createdAt)}
                </span>
              </span>
              {r.note && <span className="whitespace-pre-wrap">{r.note}</span>}
              {can('inventory') &&
                (resolving === r.id ? (
                  <form onSubmit={(e) => void done(e)} className="flex flex-col gap-2">
                    <Field label={t('reports.resolution')} hint={t('common.optional')}>
                      {(id) => (
                        <TextInput
                          id={id}
                          autoFocus
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="flex gap-2">
                      <Button type="submit" small variant="primary" busy={resolve.isPending}>
                        {t('reports.resolve')}
                      </Button>
                      <Button small onClick={() => setResolving(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button small className="self-start" onClick={() => setResolving(r.id)}>
                    {t('reports.resolve')}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {open ? (
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
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={report.isPending}>
              {t('reports.send')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <Button small className="self-start" onClick={() => setOpen(true)}>
          {t('reports.report')}
        </Button>
      )}
      <ErrorBox error={report.error ?? resolve.error} />
    </Card>
  );
}
