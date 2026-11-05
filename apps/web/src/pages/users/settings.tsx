import { SCOPES, type UserDetail, type UserLanguage } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useCreateToken, useRevokeToken, useUpdateUser } from '../../api/users';
import { ApiTokens } from '../../components/api-tokens';
import { PlacePicker } from '../../components/place-picker';
import { Card, ErrorBox, Field, Select } from '../../components/ui';
import { LANGUAGES } from '../../i18n';

/** Their keys: an admin can delete any. Only accounts without a login get new ones from here. */
export function UserTokens({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  return (
    <ApiTokens
      tokens={user.tokens}
      hint={user.hasPassword ? t('users.tokensHint') : undefined}
      create={
        user.active && !user.hasPassword
          ? {
              scopes: SCOPES,
              run: (input) => create.mutateAsync({ user: user.name, ...input }),
              busy: create.isPending,
            }
          : undefined
      }
      revoke={revoke.mutate}
      revoking={revoke.isPending}
      error={create.error ?? revoke.error}
    />
  );
}

/** What this person has chosen for themselves, for an admin to change. */
export function UserSettings({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const update = useUpdateUser();
  return (
    <Card title={t('users.settings')}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('account.home')}>
          {(id) => (
            <PlacePicker
              id={id}
              value={user.home?.code ?? ''}
              onChange={(code) => update.mutate({ name: user.name, home: code || null })}
            />
          )}
        </Field>
        <Field label={t('account.language')}>
          {(id) => (
            <Select
              id={id}
              value={user.language ?? ''}
              onChange={(e) =>
                update.mutate({
                  name: user.name,
                  language: (e.target.value || null) as UserLanguage | null,
                })
              }
            >
              <option value="">{t('users.languageBrowser')}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <p className="text-[12px] text-muted">{t('users.settingsHint')}</p>
      <ErrorBox error={update.error} />
    </Card>
  );
}
