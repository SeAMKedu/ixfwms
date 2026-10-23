import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { useChangePassword } from '../api/queries';
import { useSession } from '../auth/session';
import { LanguageSwitch } from '../components/language-switch';
import { Button, Card, ErrorBox, Field, PageHeader, TextInput } from '../components/ui';

/** Your account, plus the pages that don't fit the phone's bottom tabs. */
export function AccountPage() {
  const { t } = useTranslation();
  const { user, checking, logout } = useSession();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  if (!checking && !user) return <Navigate to="/login?next=/account" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await change.mutateAsync({ current, next });
    setCurrent('');
    setNext('');
    setDone(true);
  };
  const links = [
    ['/history', t('nav.history')],
    ['/labels', t('nav.labels')],
    ['/maps', t('nav.maps')],
    ['/import', t('nav.import')],
    ['/bom', t('nav.bom')],
    ['/setup', t('nav.setup')],
    ['/settings', t('nav.settings')],
  ];
  return (
    <>
      <PageHeader title={user?.name ?? ''} meta={user && t(`users.roles.${user.role}`)} />
      <Card title={t('account.more')}>
        <ul className="grid gap-1 sm:grid-cols-2">
          {links.map(([to, label]) => (
            <li key={to}>
              <Link to={to!} className="block rounded-md px-2 py-1.5 text-link hover:bg-surface-2">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('account.language')}>
        <LanguageSwitch />
      </Card>
      <Card title={t('account.password')}>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 sm:max-w-sm">
          <Field label={t('account.current')}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('account.next')} hint={t('users.passwordHint')}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <ErrorBox error={change.error} />
          {done && <p className="text-sm text-ok">{t('account.changed')}</p>}
          <Button type="submit" variant="primary" busy={change.isPending} className="self-start">
            {t('account.change')}
          </Button>
        </form>
      </Card>
      <Button onClick={() => void logout()} className="self-start">
        {t('nav.logout')}
      </Button>
    </>
  );
}
