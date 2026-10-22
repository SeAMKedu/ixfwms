import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useSession } from '../auth/session';
import { Button, Card, ErrorBox, Field, PageHeader, TextInput } from '../components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(name, password);
      void navigate(next?.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <PageHeader title={t('login.title')} />
      <p className="text-sm text-muted">{t('login.intro')}</p>
      <Card>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <Field label={t('login.name')}>
            {(id) => (
              <TextInput
                id={id}
                autoComplete="username"
                autoCapitalize="none"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('login.password')}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" variant="primary" busy={busy}>
            {t('login.submit')}
          </Button>
        </form>
      </Card>
      <p className="text-[13px] text-muted">{t('login.noAccount')}</p>
    </div>
  );
}
