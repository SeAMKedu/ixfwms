import { parseScannedCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import { Button, Card, ErrorBox, Field, PageHeader, TextInput } from '../components/ui';

/** Typed codes or pasted label links. Camera scanning arrives in 0.3. */
export function ScanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const scanned = parseScannedCode(text);
    if (!scanned) {
      setError(t('scan.invalid'));
      return;
    }
    if (scanned.target) {
      void navigate(scanned.target === 'location' ? `/l/${scanned.code}` : `/p/${scanned.code}`);
      return;
    }
    // A bare code can be either; codes are unique across places and parts.
    setBusy(true);
    try {
      await api(`/api/locations/${scanned.code}`);
      void navigate(`/l/${scanned.code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) void navigate(`/p/${scanned.code}`);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('scan.title')} />
      <Card>
        <p className="text-sm text-muted">{t('scan.intro')}</p>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <Field label={t('scan.input')}>
            {(id) => (
              <TextInput
                id={id}
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                className="font-mono text-lg tracking-wider"
              />
            )}
          </Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" busy={busy} className="self-start">
            {t('scan.go')}
          </Button>
        </form>
        <p className="text-[13px] text-muted">{t('scan.cameraLater')}</p>
      </Card>
    </>
  );
}
