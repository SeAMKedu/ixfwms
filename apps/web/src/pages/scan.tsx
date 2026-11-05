import { parseScannedCode, type ScannedCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { usePick } from '../api/carry';
import { lookupCode } from '../api/labels';
import { useSession } from '../auth/session';
import { QrScanner } from '../components/qr-scanner';
import { Button, Card, ErrorBox, Field, PageHeader, Segmented, TextInput } from '../components/ui';

type Mode = 'open' | 'pick' | 'drop';

/**
 * Look things up, pick things up, or say where they go: the same scanner, three modes.
 * Typed codes work everywhere, for when there's no camera or no HTTPS.
 */
export function ScanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const mode = (params.get('mode') as Mode | null) ?? 'open';
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = usePick();

  /** Bare typed codes can be a place, an item or a unit; codes are unique across all of them. */
  const resolve = async (scanned: ScannedCode): Promise<'location' | 'part' | 'unit'> => {
    if (scanned.target) return scanned.target;
    const info = await lookupCode(scanned.code);
    return info.assigned ?? 'location';
  };

  const handle = async (raw: string) => {
    const scanned = parseScannedCode(raw);
    setError(null);
    setNotice(null);
    if (!scanned) {
      setError(t('scan.invalid'));
      return;
    }
    setBusy(true);
    try {
      const target = await resolve(scanned);
      if (mode === 'drop') {
        void navigate(`/carry?to=${scanned.code}`);
      } else if (mode === 'pick' && target === 'location') {
        const state = await pick.mutateAsync({ location: scanned.code });
        const item = state.items.find((i) => i.kind === 'location' && i.code === scanned.code);
        setNotice(t('scan.picked', { name: item?.kind === 'location' ? item.name : scanned.code }));
      } else if (mode === 'pick' && target === 'unit') {
        const state = await pick.mutateAsync({ unit: scanned.code });
        const item = state.items.find((i) => i.kind === 'unit' && i.code === scanned.code);
        setNotice(t('scan.picked', { name: item?.kind === 'unit' ? item.name : scanned.code }));
      } else if (mode === 'pick') {
        setNotice(t('scan.partNeedsLot'));
        void navigate(`/p/${scanned.code}`);
      } else {
        const prefix = { location: 'l', part: 'p', unit: 'u' }[target];
        void navigate(`/${prefix}/${scanned.code}`);
      }
      setText('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void handle(text);
  };
  const setMode = (m: Mode) => {
    setNotice(null);
    setParams(m === 'open' ? {} : { mode: m }, { replace: true });
  };

  return (
    <>
      <PageHeader title={t('scan.title')} />
      {can('inventory') && (
        <Segmented<Mode>
          label={t('scan.modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'open', label: t('scan.modeOpen') },
            { value: 'pick', label: t('scan.modePick') },
            { value: 'drop', label: t('scan.modeDrop') },
          ]}
        />
      )}
      <p className="text-sm text-muted">
        {mode === 'pick'
          ? t('scan.pickHint')
          : mode === 'drop'
            ? t('scan.dropHint')
            : t('scan.intro')}
      </p>
      <QrScanner onScan={(value) => void handle(value)} paused={busy} />
      {notice && (
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          {notice}
        </p>
      )}
      <ErrorBox error={error} />
      <Card>
        <form onSubmit={submit} className="flex items-end gap-2">
          <Field label={t('scan.input')}>
            {(id) => (
              <TextInput
                id={id}
                autoCapitalize="characters"
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="font-mono tracking-wider"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" busy={busy}>
            {t('scan.go')}
          </Button>
        </form>
      </Card>
    </>
  );
}
