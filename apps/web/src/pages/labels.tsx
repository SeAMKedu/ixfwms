import { normalizeCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from '../api/client';
import { qs } from '../api/client';
import { useLabelBatches, useRetireCodes } from '../api/queries';
import { useSession } from '../auth/session';
import { formatDate } from '../lib/format';
import { PlacePicker } from '../components/place-picker';
import { Button, Card, ErrorBox, Field, PageHeader, Select, TextInput } from '../components/ui';

/** Printed blank-label batches: get a lost printout again, or retire codes whose labels are gone. */
function Batches() {
  const { t } = useTranslation();
  const batches = useLabelBatches(true);
  const retire = useRetireCodes();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  if (!batches.data?.length) return null;
  const toggle = (code: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  return (
    <Card title={t('labels.batchesTitle')} className="md:col-span-2">
      <p className="text-sm text-muted">{t('labels.batchesIntro')}</p>
      <ul className="flex flex-col">
        {batches.data.map((b) => {
          const key = b.id ?? 'none';
          return (
            <li
              key={key}
              className="flex flex-col gap-2 border-t border-line py-2.5 first:border-t-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {formatDate(b.createdAt)}
                  {b.createdBy && ` · ${b.createdBy}`}
                  <span className="ml-2 text-muted">
                    {t('labels.batchCounts', {
                      unused: b.unused.length,
                      used: b.used,
                      retired: b.retired,
                    })}
                  </span>
                </span>
                <span className="flex gap-3 text-[13px]">
                  {b.unused.length > 0 && (
                    <a
                      href={`/api/labels/batches/${key}/labels.csv`}
                      download
                      className="text-link hover:underline"
                    >
                      {t('labels.downloadUnused')}
                    </a>
                  )}
                  {b.unused.length > 0 && (
                    <button
                      type="button"
                      className="text-link hover:underline"
                      onClick={() => setOpen(open === key ? null : key)}
                    >
                      {open === key ? t('labels.hideCodes') : t('labels.showCodes')}
                    </button>
                  )}
                </span>
              </div>
              {open === key && (
                <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {b.unused.map((code) => (
                      <label
                        key={code}
                        className="inline-flex items-center gap-1.5 font-mono text-[13px]"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(code)}
                          onChange={() => toggle(code)}
                        />
                        {code}
                      </label>
                    ))}
                  </div>
                  <Button
                    small
                    className="self-start"
                    disabled={picked.size === 0}
                    busy={retire.isPending}
                    onClick={() =>
                      retire.mutate([...picked], { onSuccess: () => setPicked(new Set()) })
                    }
                  >
                    {t('labels.retire', { count: picked.size })}
                  </Button>
                  <p className="text-[12px] text-muted">{t('labels.retireHint')}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorBox error={retire.error} />
    </Card>
  );
}

export function LabelsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [count, setCount] = useState('24');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [place, setPlace] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [include, setInclude] = useState<'locations' | 'parts' | 'all'>('locations');

  const blank = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await download('/api/labels/blank', 'ixfwms-blank-labels.csv', {
        count: Number(count),
        format: 'csv',
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const placeCsv = `/api/labels.csv${qs({ location: place ? normalizeCode(place) : undefined, recursive, include })}`;

  return (
    <>
      <PageHeader title={t('labels.title')} />
      <div className="grid gap-4 md:grid-cols-2">
        {can('inventory') && (
          <Card title={t('labels.blankTitle')}>
            <p className="text-sm text-muted">{t('labels.blankIntro')}</p>
            <form onSubmit={(e) => void blank(e)} className="flex items-end gap-2">
              <Field label={t('labels.blankCount')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={1}
                    max={500}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="w-28"
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" busy={busy}>
                {t('labels.blankDownload')}
              </Button>
            </form>
            <ErrorBox error={error} />
          </Card>
        )}
        <Card title={t('labels.placeTitle')}>
          <p className="text-sm text-muted">{t('labels.placeIntro')}</p>
          <Field label={t('labels.placeCode')}>
            {(id) => <PlacePicker id={id} value={place} onChange={setPlace} />}
          </Field>
          <Field label={t('labels.include')}>
            {(id) => (
              <Select
                id={id}
                value={include}
                onChange={(e) => setInclude(e.target.value as typeof include)}
              >
                <option value="locations">{t('labels.includeLocations')}</option>
                <option value="parts">{t('labels.includeParts')}</option>
                <option value="all">{t('labels.includeAll')}</option>
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
            {t('labels.recursive')}
          </label>
          <a
            href={place ? placeCsv : undefined}
            download
            aria-disabled={!place}
            className={`self-start rounded-lg border px-3.5 py-2 text-sm font-semibold ${place ? 'border-ink bg-ink text-bg' : 'pointer-events-none border-line text-muted'}`}
          >
            {t('labels.download')}
          </a>
        </Card>
        {can('inventory') && <Batches />}
        <Card title={t('labels.ptouchTitle')}>
          <p className="text-sm">{t('labels.ptouchSteps')}</p>
        </Card>
        <Card title={t('labels.laserTitle')}>
          <p className="text-sm">{t('labels.laserIntro')}</p>
        </Card>
      </div>
    </>
  );
}
