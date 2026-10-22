import { normalizeCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from '../api/client';
import { qs } from '../api/client';
import { useSession } from '../auth/session';
import { Button, Card, ErrorBox, Field, PageHeader, Select, TextInput } from '../components/ui';

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
            {(id) => (
              <TextInput
                id={id}
                autoCapitalize="characters"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                className="font-mono"
              />
            )}
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
