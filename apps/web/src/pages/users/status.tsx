import { type UserDetail } from '@ixfwms/domain';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeactivateUser, useDeleteUser, useEraseUser, useReactivateUser } from '../../api/users';
import { Button, Card, ErrorBox } from '../../components/ui';
import { formatDate } from '../../lib/format';

/** Turning a user off (or back on), removing one that has no history, or erasing one that has. */
export function Status({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const off = useDeactivateUser();
  const on = useReactivateUser();
  const remove = useDeleteUser();
  const erase = useEraseUser();
  // No history: remove the account. History: erase the person, keep what they did.
  const gone = user.canDelete ? remove : erase;
  const [confirm, setConfirm] = useState(false);
  const blocked = user.openLoans > 0 || user.carrying > 0;
  return (
    <Card title={t('users.status')}>
      {user.active ? (
        <>
          <p className="max-w-prose text-sm text-muted">{t('users.offHint')}</p>
          {user.openLoans > 0 && (
            <p className="text-sm text-warn">{t('users.hasLoans', { count: user.openLoans })}</p>
          )}
          {user.carrying > 0 && (
            <p className="text-sm text-warn">{t('users.isCarrying', { count: user.carrying })}</p>
          )}
          <Button
            className="self-start"
            disabled={blocked}
            busy={off.isPending}
            onClick={() => off.mutate(user.name)}
          >
            {t('users.turnOff')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">
            {t('users.offSince', { date: formatDate(user.disabledAt ?? user.createdAt) })}
          </p>
          <Button className="self-start" busy={on.isPending} onClick={() => on.mutate(user.name)}>
            {t('users.turnOn')}
          </Button>
        </>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="max-w-prose text-sm text-muted">
          {user.canDelete ? t('users.removeHint') : t('users.cantRemove', { count: user.history })}
        </p>
        {!user.canDelete && (
          <p className="max-w-prose text-sm text-muted">{t('users.eraseHint')}</p>
        )}
        {confirm ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="!border-crit !bg-crit"
              busy={gone.isPending}
              onClick={() =>
                void gone
                  .mutateAsync(user.name)
                  .then(() => navigate('/settings/users', { replace: true }))
              }
            >
              {t(user.canDelete ? 'users.removeConfirm' : 'users.eraseConfirm', {
                name: user.name,
              })}
            </Button>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          </div>
        ) : (
          <Button
            className="self-start"
            disabled={!user.canDelete && blocked}
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            {t(user.canDelete ? 'users.remove' : 'users.erase')}
          </Button>
        )}
      </div>
      <ErrorBox error={off.error ?? on.error ?? gone.error} />
    </Card>
  );
}
