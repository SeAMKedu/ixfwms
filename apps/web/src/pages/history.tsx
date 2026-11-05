import type { HistoryEntry } from '@ixfwms/domain';
import { Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHistory, useUndo } from '../api/history';
import { useSession } from '../auth/session';
import { Button, Card, CodeLabel, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { formatDate } from '../lib/format';

function Place({ place }: { place: { code: string; name: string } | null }) {
  if (!place) return null;
  return place.code ? (
    <Link to={`/l/${place.code}`} className="inline-flex items-center gap-1 hover:underline">
      {place.name}
      <CodeLabel code={place.code} />
    </Link>
  ) : (
    <span>{place.name}</span>
  );
}

/** A unit event's firmware version, problem or status, and its note. */
function unitDetail(t: ReturnType<typeof useTranslation>['t'], e: HistoryEntry): string {
  const value =
    e.value && e.action === 'problem'
      ? t(`reportKinds.${e.value}`, { defaultValue: e.value })
      : e.value && e.action === 'status'
        ? t(`unitStatus.${e.value}`, { defaultValue: e.value })
        : e.value;
  return [value, e.text].filter(Boolean).join(' · ');
}

function Entry({ e, canUndo }: { e: HistoryEntry; canUndo: boolean }) {
  const { t } = useTranslation();
  const undo = useUndo();
  const detail = e.kind === 'unit' ? unitDetail(t, e) : '';
  const subject = e.unit ? (
    <Link to={`/u/${e.unit.code}`} className="font-medium hover:underline">
      {e.unit.name}
    </Link>
  ) : e.part ? (
    e.part.code ? (
      <Link to={`/p/${e.part.code}`} className="font-medium hover:underline">
        {e.part.name}
      </Link>
    ) : (
      <span className="font-medium">{e.part.name}</span>
    )
  ) : (
    <span className="font-medium">
      <Place place={e.place} />
    </span>
  );
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-t border-line py-2.5 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted">
            {e.kind === 'unit'
              ? t(`unitEvents.${e.action}`, { defaultValue: e.action })
              : t(`history.actions.${e.action}`, { defaultValue: e.action })}
          </span>
          {subject}
          {e.delta != null && (
            <span className="tabular text-muted">{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
          )}
        </span>
        {detail && <span className="text-[13px] whitespace-pre-wrap">{detail}</span>}
        {(e.from || e.to) && (
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
            <Place place={e.from} />
            {e.from && e.to && <span aria-hidden>→</span>}
            <Place place={e.to} />
          </span>
        )}
        <span className="text-[12px] text-muted">
          {formatDate(e.at)}
          {e.user && ` · ${e.user}`}
        </span>
        <ErrorBox error={undo.error} />
      </div>
      {canUndo && e.undoable && (e.kind === 'stock' || e.kind === 'location') && (
        <Button
          small
          busy={undo.isPending}
          onClick={() => undo.mutate({ kind: e.kind as 'stock' | 'location', id: e.id })}
        >
          <Undo2 className="size-4" aria-hidden />
          {t('history.undo')}
        </Button>
      )}
    </li>
  );
}

/** What changed lately, newest first; moves can be undone. */
export function HistoryPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const history = useHistory();
  return (
    <>
      <PageHeader title={t('history.title')} />
      <ErrorBox error={history.error} />
      {history.isPending ? (
        <Loading />
      ) : (
        <Card>
          {history.data?.length === 0 ? (
            <Empty>{t('history.empty')}</Empty>
          ) : (
            <ul>
              {history.data?.map((e) => (
                <Entry key={`${e.kind}-${e.id}`} e={e} canUndo={can('inventory')} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
