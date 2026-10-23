import { SCOPES, USER_ROLES, type Scope, type UserInfo, type UserRole } from '@ixfwms/domain';
import { Copy, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import {
  useCreateToken,
  useCreateUser,
  useInfo,
  useRevokeToken,
  useUpdateUser,
  useUsers,
} from '../api/queries';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Pill,
  Select,
  TextInput,
} from '../components/ui';
import { formatDate } from '../lib/format';

/** Shows a new token once, with the command to connect Claude Code to it. */
function NewToken({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const info = useInfo();
  const command = `claude mcp add --transport http ixfwms ${info.data?.mcpUrl ?? '<server>/mcp'} --header "Authorization: Bearer ${token}"`;
  const [copied, setCopied] = useState('');
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => setCopied(''),
    );
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
      <strong className="text-warn">{t('users.tokenOnce')}</strong>
      <code className="break-all rounded bg-surface px-2 py-1 font-mono text-[13px]">{token}</code>
      <Button small onClick={() => void copy(token)} className="self-start">
        <Copy className="size-4" aria-hidden />
        {copied === token ? t('users.copied') : t('users.copy')}
      </Button>
      <span className="text-muted">{t('users.connectClaude')}</span>
      <code className="break-all rounded bg-surface px-2 py-1 font-mono text-[12px]">
        {command}
      </code>
      <Button small onClick={() => void copy(command)} className="self-start">
        <Copy className="size-4" aria-hidden />
        {copied === command ? t('users.copied') : t('users.copyCommand')}
      </Button>
      <Button small variant="ghost" onClick={onDone} className="self-start">
        {t('users.tokenSaved')}
      </Button>
    </div>
  );
}

function UserCard({ user }: { user: UserInfo }) {
  const { t } = useTranslation();
  const update = useUpdateUser();
  const createToken = useCreateToken();
  const revoke = useRevokeToken();
  const [password, setPassword] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['inventory']);
  const [newToken, setNewToken] = useState<string | null>(null);

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({ name: user.name, password });
    setPassword('');
  };
  const addToken = async (e: FormEvent) => {
    e.preventDefault();
    const res = await createToken.mutateAsync({ user: user.name, name: tokenName, scopes });
    setNewToken(res.token);
    setTokenName('');
  };
  const apiTokens = user.tokens.filter((tk) => tk.kind === 'api');
  const sessions = user.tokens.filter((tk) => tk.kind === 'session').length;

  return (
    <Card title={user.name}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('users.role')}>
          {(id) => (
            <Select
              id={id}
              value={user.role}
              onChange={(e) => update.mutate({ name: user.name, role: e.target.value as UserRole })}
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
          <Field label={user.hasPassword ? t('users.newPassword') : t('users.setPassword')}>
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
      <span className="text-[13px] text-muted">{t('users.sessions', { count: sessions })}</span>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">{t('users.tokens')}</span>
        {apiTokens.length === 0 && (
          <span className="text-sm text-muted">{t('users.noTokens')}</span>
        )}
        {apiTokens.map((tk) => (
          <div key={tk.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex flex-wrap items-center gap-1.5">
              {tk.name}
              {tk.scopes.map((s) => (
                <Pill key={s} tone="info">
                  {s}
                </Pill>
              ))}
              <span className="text-[12px] text-muted">
                {tk.lastUsedAt
                  ? t('users.lastUsed', { date: formatDate(tk.lastUsedAt) })
                  : t('users.neverUsed')}
              </span>
            </span>
            <Button
              small
              variant="ghost"
              aria-label={t('users.revoke')}
              busy={revoke.isPending}
              onClick={() => revoke.mutate(tk.id)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      {newToken ? (
        <NewToken token={newToken} onDone={() => setNewToken(null)} />
      ) : (
        <form onSubmit={(e) => void addToken(e)} className="flex flex-wrap items-end gap-2">
          <Field label={t('users.tokenName')}>
            {(id) => (
              <TextInput
                id={id}
                required
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder={t('users.tokenPlaceholder')}
                className="!w-48"
              />
            )}
          </Field>
          <fieldset className="flex flex-wrap items-center gap-3 pb-2 text-sm">
            <legend className="sr-only">{t('users.scopes')}</legend>
            {SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes((cur) =>
                      e.target.checked ? [...cur, s] : cur.filter((x) => x !== s),
                    )
                  }
                />
                {s}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={scopes.length === 0} busy={createToken.isPending}>
            {t('users.createToken')}
          </Button>
        </form>
      )}
      <ErrorBox error={update.error ?? createToken.error ?? revoke.error} />
    </Card>
  );
}

/** People, their roles and passwords, and API tokens for scripts and AI assistants. Admins only. */
export function UsersPage() {
  const { t } = useTranslation();
  const { can, checking } = useSession();
  const isAdmin = can('admin');
  const users = useUsers(isAdmin);
  const create = useCreateUser();
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [password, setPassword] = useState('');
  if (!checking && !isAdmin) return <Navigate to="/account" replace />;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name, role, password: password || undefined });
    setName('');
    setPassword('');
  };
  return (
    <>
      <PageHeader title={t('users.title')} />
      <p className="max-w-prose text-sm text-muted">{t('users.intro')}</p>
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
          <Field label={t('login.password')} hint={t('users.passwordHint')}>
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
        <ErrorBox error={create.error} />
      </Card>
      {users.isPending ? <Loading /> : users.data?.map((u) => <UserCard key={u.id} user={u} />)}
    </>
  );
}
