import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useUnit } from '../api/queries';
import { useSession } from '../auth/session';
import { LabelPanel } from '../components/label-panel';
import {
  Card,
  CategoryPath,
  CodeLabel,
  ErrorBox,
  Loading,
  PageHeader,
  isNotFound,
} from '../components/ui';
import { UnitStatusPill } from '../components/units';
import { formatDay } from '../lib/format';
import { NotFoundPage } from './not-found';
import { Where } from './unit/where';
import { Problems } from './unit/problems';
import { Details } from './unit/details';
import { Log } from './unit/log';

export function UnitPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const unit = useUnit(code);
  if (unit.isPending) return <Loading />;
  if (isNotFound(unit.error)) return <NotFoundPage code={code} />;
  if (!unit.data) return <ErrorBox error={unit.error} />;
  const u = unit.data;
  const pastLoans = u.loans.filter((l) => l.returnedAt);
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-2">
            <Link to={`/p/${u.part.code}`} className="text-link hover:underline">
              {u.part.name}
            </Link>
            {u.part.category && <CategoryPath path={u.part.category} />}
          </span>
        }
        title={u.name}
        qr={u.code}
        meta={
          <>
            <CodeLabel code={u.code} />
            <UnitStatusPill status={u.status} />
            {u.serialNo && (
              <span className="font-mono">{t('units.serialShort', { serial: u.serialNo })}</span>
            )}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Where unit={u} />
        <Problems unit={u} />
        <Details unit={u} />
        <Log unit={u} />
        {pastLoans.length > 0 && (
          <Card title={t('units.pastLoans')} className="md:col-span-2">
            <ul className="flex flex-col gap-1.5 text-sm">
              {pastLoans.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {l.description} <span className="text-muted">· {l.responsible}</span>
                  </span>
                  <span className="text-[12px] text-muted tabular">
                    {formatDay(l.outAt)} – {l.returnedAt && formatDay(l.returnedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {can('inventory') && <LabelPanel code={u.code} fix="unit" />}
    </>
  );
}
