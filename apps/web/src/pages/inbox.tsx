import { normalizeCode, type LocationContentItem } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useEveryoneCarrying,
  useInfo,
  useLocation,
  useMoveStock,
  useParts,
  useSetStatus,
  useLabSettings,
  useLoans,
  useOverdue,
  useReports,
  useResolveReport,
  useUnitAttention,
} from '../api/queries';
import { UnitStatusPill, UnitWhere } from '../components/units';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import { formatDate, formatDay } from '../lib/format';
import {
  AmountPill,
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Pill,
  PlaceTag,
} from '../components/ui';

function PutAway({ item }: { item: LocationContentItem }) {
  const { t } = useTranslation();
  const [to, setTo] = useState('');
  const move = useMoveStock();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await move.mutateAsync({ lotId: item.lotId, to: normalizeCode(to) });
  };
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <Link to={`/p/${item.part.code}`} className="min-w-0 truncate font-medium hover:underline">
          {item.part.name}
        </Link>
        <AmountPill display={item.display} />
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <PlacePicker
          value={to}
          onChange={setTo}
          label={t('inbox.putAwayTo')}
          placeholder={t('inbox.putAwayTo')}
        />
        <Button type="submit" variant="dark" small busy={move.isPending} disabled={!to}>
          {t('inbox.putAway')}
        </Button>
      </form>
      <ErrorBox error={move.error} />
    </li>
  );
}

function ConfirmButton({ code }: { code: string }) {
  const { t } = useTranslation();
  const setStatus = useSetStatus(code);
  return (
    <Button
      small
      variant="primary"
      busy={setStatus.isPending}
      onClick={() => setStatus.mutate('active')}
    >
      {t('part.confirm')}
    </Button>
  );
}

const HOUR_MS = 60 * 60 * 1000;

const ownerPath = { unit: 'u', part: 'p', location: 'l' } as const;

/** Problem reports from anyone, until someone resolves them. */
function Problems() {
  const { t } = useTranslation();
  const { can } = useSession();
  const reports = useReports();
  const resolve = useResolveReport();
  if (!reports.data?.length) return null;
  return (
    <Card title={t('reports.inboxTitle', { count: reports.data.length })}>
      <ul className="flex flex-col gap-2 text-sm">
        {reports.data.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/${ownerPath[r.owner]}/${r.target.code}`}
                  className="font-medium hover:underline"
                >
                  {r.target.name}
                </Link>
                <Pill tone={r.kind === 'broken' ? 'crit' : 'warn'}>
                  {t(`reportKinds.${r.kind}`)}
                </Pill>
              </span>
              {r.note && <span className="whitespace-pre-wrap">{r.note}</span>}
              <span className="text-[12px] text-muted">
                {[
                  r.guest
                    ? r.by
                      ? t('units.guestBy', { name: r.by })
                      : t('units.guestAnonymous')
                    : r.by,
                  formatDate(r.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {can('inventory') && (
              <Button small busy={resolve.isPending} onClick={() => resolve.mutate({ id: r.id })}>
                {t('reports.resolve')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={resolve.error} />
    </Card>
  );
}

/** Units lent out of the lab, overdue ones first and in red. */
function OutOnLoan() {
  const { t } = useTranslation();
  const loans = useLoans();
  if (!loans.data?.length) return null;
  const sorted = [...loans.data].sort((a, b) => Number(b.overdue) - Number(a.overdue));
  return (
    <Card title={t('units.onLoanTitle', { count: loans.data.length })}>
      <ul className="flex flex-col gap-2 text-sm">
        {sorted.map((l) => (
          <li key={l.id} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <Link
                to={`/u/${l.unit.code}`}
                className={`font-medium hover:underline ${l.overdue ? 'text-crit' : ''}`}
              >
                {l.unit.name}
              </Link>
              {l.overdue && <Pill tone="crit">{t('units.overdue')}</Pill>}
            </span>
            <span className="text-[12px] text-muted">
              {[
                l.description,
                t('units.responsible', { name: l.responsible }),
                l.dueAt && t('units.dueBack', { date: formatDay(l.dueAt) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Broken, in repair or due for a check; units with an open report are already listed above. */
function UnitsAttention() {
  const { t } = useTranslation();
  const list = useUnitAttention();
  const reported = new Set(
    (useReports().data ?? []).filter((r) => r.owner === 'unit').map((r) => r.target.code),
  );
  const shown = (list.data ?? []).filter(
    (a) => a.reason === 'check_due' || !reported.has(a.unit.code),
  );
  if (!shown.length) return null;
  return (
    <Card title={t('units.attentionTitle')}>
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((a) => (
          <li key={a.unit.id} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/u/${a.unit.code}`} className="font-medium hover:underline">
                {a.unit.name}
              </Link>
              <UnitStatusPill status={a.unit.status} />
              {a.reason === 'check_due' && a.nextCheckAt && (
                <Pill tone="warn">{t('units.checkDueOn', { date: formatDay(a.nextCheckAt) })}</Pill>
              )}
            </span>
            <UnitWhere unit={a.unit} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Temporary places (pallets…) nobody has touched for longer than expected. */
function NeedsAttention() {
  const { t } = useTranslation();
  const overdue = useOverdue();
  if (!overdue.data?.length) return null;
  return (
    <Card title={t('inbox.attention')}>
      <ul className="flex flex-col gap-2 text-sm">
        {overdue.data.map((o) => (
          <li key={o.place.id} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/l/${o.place.code}`} className="font-medium text-warn hover:underline">
                {o.place.name}
              </Link>
              <PlaceTag place={o.place} />
            </span>
            <span className="text-[12px] text-muted">
              {[
                o.path.length > 1 &&
                  o.path
                    .slice(0, -1)
                    .map((p) => p.name)
                    .join(' › '),
                t('temporary.lastActivity', { date: formatDate(o.lastActivityAt) }),
                o.contact && t('temporary.contactIs', { contact: o.contact }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Things picked up and not put down: after a few hours they were probably forgotten. */
function StillCarried() {
  const { t } = useTranslation();
  const carrying = useEveryoneCarrying();
  const settings = useLabSettings();
  const forgottenMs = (settings.data?.carryForgottenHours ?? 4) * HOUR_MS;
  if (!carrying.data?.length) return null;
  return (
    <Card title={t('inbox.carrying')}>
      <ul className="flex flex-col gap-1 text-sm">
        {carrying.data.map((c) => {
          // eslint-disable-next-line react-hooks/purity -- a slightly stale "now" is fine for this hint
          const old = Date.now() - Date.parse(c.since) > forgottenMs;
          return (
            <li key={c.location.id}>
              <Link
                to={`/l/${c.location.code}`}
                className={old ? 'text-warn hover:underline' : 'hover:underline'}
              >
                {t('inbox.carryingItem', {
                  user: c.user,
                  count: c.count,
                  date: formatDate(c.since),
                })}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function InboxPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const info = useInfo();
  const drafts = useParts({ status: 'draft', limit: 200 });
  const inbox = useLocation(info.data?.inboxCode ?? '', false);
  const unplaced = info.data ? inbox.data?.contents : undefined;

  return (
    <>
      <PageHeader title={t('inbox.title')} />
      <p className="max-w-prose text-sm text-muted">{t('inbox.intro')}</p>
      <Problems />
      <NeedsAttention />
      <UnitsAttention />
      <OutOnLoan />
      <StillCarried />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('inbox.unplaced')}>
          <ErrorBox error={info.error ?? inbox.error} />
          {!unplaced ? (
            <Loading />
          ) : unplaced.length === 0 ? (
            <Empty>{t('inbox.noUnplaced')}</Empty>
          ) : (
            <ul>
              {unplaced.map((item) =>
                can('inventory') ? (
                  <PutAway key={item.lotId} item={item} />
                ) : (
                  <li
                    key={item.lotId}
                    className="flex justify-between gap-2 border-t border-line py-2 first:border-t-0"
                  >
                    <Link to={`/p/${item.part.code}`}>{item.part.name}</Link>
                    <AmountPill display={item.display} />
                  </li>
                ),
              )}
            </ul>
          )}
        </Card>
        <Card title={t('inbox.drafts')}>
          <ErrorBox error={drafts.error} />
          {drafts.isPending ? (
            <Loading />
          ) : drafts.data?.items.length === 0 ? (
            <Empty>{t('inbox.noDrafts')}</Empty>
          ) : (
            <ul>
              {drafts.data?.items.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 border-t border-line py-2.5 first:border-t-0"
                >
                  <Link to={`/p/${p.code}`} className="min-w-0">
                    <span className="block truncate font-medium hover:underline">{p.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-muted">
                      {[p.manufacturer, p.identifiers[0]?.value].filter(Boolean).join(' · ') ||
                        p.code}
                    </span>
                  </Link>
                  {can('write') && <ConfirmButton code={p.code} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
