import { USER_ROLES, type UserRole } from '@ixfwms/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useCreateUser, useUpdateUser, useUser, useUsers } from '../api/users';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Pill,
  Select,
  TextInput,
  isNotFound,
} from '../components/ui';
import { formatDate } from '../lib/format';
import { UserTokens, UserSettings } from './users/settings';
import { Status } from './users/status';

/** One user: role, password, settings, tokens, and turning the account off or removing it. */
export function UserPage() {
  const { t } = useTranslation();
  const { name = '' } = useParams();
  const { can, checking, user: me } = useSession();
  const isAdmin = can('admin');
  const user = useUser(name, isAdmin);
  const update = useUpdateUser();
  const [password, setPassword] = useState('');
  if (!checking && !isAdmin) return <Navigate to="/account" replace />;
  if (user.isPending) return <Loading />;
  if (isNotFound(user.error)) return <Empty>{t('users.notFound', { name })}</Empty>;
  if (!user.data) return <ErrorBox error={user.error} />;
  const u = user.data;
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({ name: u.name, password });
    setPassword('');
  };
  return (
    <>
      <Link
        to="/settings/users"
        className="inline-flex items-center gap-1 self-start text-sm text-link"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('nav.users')}
      </Link>
      <PageHeader
        title={u.name}
        meta={
          <>
            <span>{t(`users.roles.${u.role}`)}</span>
            {!u.active && <Pill tone="muted">{t('users.off')}</Pill>}
            {me?.name === u.name && <Pill tone="info">{t('users.you')}</Pill>}
          </>
        }
      />
      <Card title={t('users.details')}>
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('users.role')}>
            {(id) => (
              <Select
                id={id}
                value={u.role}
                onChange={(e) => update.mutate({ name: u.name, role: e.target.value as UserRole })}
                className="!w-auto"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <form onSubmit={(e) => void savePassword(e)} className="flex items-end gap-2">
            <Field label={u.hasPassword ? t('users.newPassword') : t('users.setPassword')}>
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="!w-48"
                />
              )}
            </Field>
            <Button type="submit" disabled={password.length < 8} busy={update.isPending}>
              {t('common.save')}
            </Button>
          </form>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">{t('users.created')}</dt>
          <dd>{formatDate(u.createdAt)}</dd>
          <dt className="text-muted">{t('users.lastActive')}</dt>
          <dd>{u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}</dd>
          <dt className="text-muted">{t('users.historyCount')}</dt>
          <dd className="tabular">{u.history}</dd>
        </dl>
        <ErrorBox error={update.error} />
      </Card>
      <UserSettings user={u} />
      <UserTokens user={u} />
      {me?.name !== u.name && <Status user={u} />}
    </>
  );
}

/** People: one line each, opening a page per person. Admins only. */
export function UsersPage() {
  const { t } = useTranslation();
  const { can, checking } = useSession();
  const isAdmin = can('admin');
  const users = useUsers(isAdmin);
  const create = useCreateUser();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [password, setPassword] = useState('');
  const [showOff, setShowOff] = useState(false);
  if (!checking && !isAdmin) return <Navigate to="/account" replace />;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name, role, password: password || undefined });
    void navigate(`/settings/users/${encodeURIComponent(name)}`);
  };
  const all = users.data ?? [];
  const offCount = all.filter((u) => !u.active).length;
  const shown = all.filter((u) => u.active || showOff);
  const th = 'px-2 py-2 font-medium whitespace-nowrap';
  return (
    <>
      <PageHeader title={t('users.title')} />
      <p className="max-w-prose text-sm text-muted">{t('users.intro')}</p>
      <Card>
        {users.isPending ? (
          <Loading />
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-[14px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  <th className={`${th} pl-0`}>{t('login.name')}</th>
                  <th className={th}>{t('users.role')}</th>
                  <th className={th}>{t('users.colLogin')}</th>
                  <th className={`${th} text-right`}>{t('users.tokens')}</th>
                  <th className={th}>{t('users.lastActive')}</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const tokens = u.tokens.filter((tk) => tk.kind === 'api').length;
                  return (
                    <tr
                      key={u.id}
                      className={`border-t border-line hover:bg-surface-2 ${u.active ? '' : 'text-muted'}`}
                    >
                      <td className="py-2 pr-2">
                        <Link
                          to={`/settings/users/${encodeURIComponent(u.name)}`}
                          className="inline-flex items-center gap-1.5 font-medium hover:underline"
                        >
                          {u.name}
                          {!u.active && <Pill tone="muted">{t('users.off')}</Pill>}
                        </Link>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{t(`users.roles.${u.role}`)}</td>
                      <td className="px-2 py-2">
                        {u.hasPassword ? t('users.password') : t('users.tokensOnly')}
                      </td>
                      <td className="tabular px-2 py-2 text-right">{tokens || '—'}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-muted">
                        {u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}
                      </td>
                      <td className="py-2 pl-1 text-right">
                        <Link
                          to={`/settings/users/${encodeURIComponent(u.name)}`}
                          aria-label={t('users.open', { name: u.name })}
                          className="inline-flex text-muted hover:text-link"
                        >
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {offCount > 0 && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={showOff}
              onChange={(e) => setShowOff(e.target.checked)}
            />
            {t('users.showOff', { count: offCount })}
          </label>
        )}
      </Card>
      <Card title={t('users.add')}>
        <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-2">
          <Field label={t('login.name')}>
            {(id) => (
              <TextInput
                id={id}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="!w-40"
              />
            )}
          </Field>
          <Field label={t('users.role')}>
            {(id) => (
              <Select
                id={id}
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="!w-auto"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('login.password')}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="!w-48"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" busy={create.isPending}>
            {t('common.add')}
          </Button>
        </form>
        <p className="text-[12px] text-muted">{t('users.passwordHint')}</p>
        <ErrorBox error={create.error} />
      </Card>
    </>
  );
}
