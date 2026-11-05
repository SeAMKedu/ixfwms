import { type Scope, type TokenInfo } from '@ixfwms/domain';
import { Copy, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfo } from '../api/system';
import { formatDate } from '../lib/format';
import { Button, Card, ErrorBox, Field, Pill, TextInput } from './ui';

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

interface Props {
  tokens: TokenInfo[];
  hint?: string;
  /** Left out where new tokens aren't made. */
  create?: {
    scopes: readonly Scope[];
    run: (input: { name: string; scopes: Scope[] }) => Promise<{ token: string }>;
    busy: boolean;
  };
  revoke: (id: string) => void;
  revoking: boolean;
  error: unknown;
}

/** API tokens of one person: on their own account page, or an admin's page for them. */
export function ApiTokens({ tokens, hint, create, revoke, revoking, error }: Props) {
  const { t } = useTranslation();
  const [tokenName, setTokenName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['inventory']);
  const [newToken, setNewToken] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const res = await create!.run({ name: tokenName, scopes });
    setNewToken(res.token);
    setTokenName('');
  };
  const apiTokens = tokens.filter((tk) => tk.kind === 'api');
  const sessions = tokens.filter((tk) => tk.kind === 'session').length;
  return (
    <Card title={t('users.tokens')}>
      <span className="text-[13px] text-muted">{t('users.sessions', { count: sessions })}</span>
      {hint && <p className="max-w-prose text-sm text-muted">{hint}</p>}
      {apiTokens.length === 0 && <span className="text-sm text-muted">{t('users.noTokens')}</span>}
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
            busy={revoking}
            onClick={() => revoke(tk.id)}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      {newToken ? (
        <NewToken token={newToken} onDone={() => setNewToken(null)} />
      ) : (
        create && (
          <form
            onSubmit={(e) => void add(e)}
            className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
          >
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
              {create.scopes.map((s) => (
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
            <Button type="submit" disabled={scopes.length === 0} busy={create.busy}>
              {t('users.createToken')}
            </Button>
          </form>
        )
      )}
      <ErrorBox error={error} />
    </Card>
  );
}
