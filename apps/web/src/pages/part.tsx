import { Pencil } from 'lucide-react';
import { unitLabel } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useShortcut } from '../lib/shortcuts';
import { usePart } from '../api/parts';
import { useSession } from '../auth/session';
import { AttributeList } from '../components/attribute-fields';
import { LabelPanel } from '../components/label-panel';
import {
  ButtonLink,
  Card,
  CategoryPath,
  CodeLabel,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Pill,
  StatusPill,
  isNotFound,
} from '../components/ui';
import { UnitList } from '../components/units';
import { formatDate } from '../lib/format';
import { NotFoundPage } from './not-found';
import { LotRow } from './part/lot-row';
import { AddStock, AddUnits } from './part/add-stock';
import { ReportItem } from './part/report-item';
import { Files } from './part/files';
import { Review } from './part/review';

export function PartPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const part = usePart(code);
  const navigate = useNavigate();
  useShortcut(
    'e',
    t('shortcuts.edit'),
    () => void navigate(`/p/${code}/edit`),
    can('inventory') && !!part.data,
  );
  if (part.isPending) return <Loading />;
  if (isNotFound(part.error)) return <NotFoundPage code={code} />;
  if (!part.data) return <ErrorBox error={part.error} />;
  const p = part.data;
  const canEdit = can('inventory');

  return (
    <>
      <PageHeader
        eyebrow={p.category && <CategoryPath path={p.category} />}
        title={p.name}
        qr={p.code}
        meta={
          <>
            <CodeLabel code={p.code} />
            <StatusPill status={p.status} />
            {p.kind !== 'part' && <Pill tone="info">{t(`partKinds.${p.kind}`)}</Pill>}
            {p.manufacturer && <span>{p.manufacturer}</span>}
          </>
        }
        actions={
          canEdit && (
            <ButtonLink to={`/p/${p.code}/edit`}>
              <Pencil className="size-4" aria-hidden />
              {t('common.edit')}
            </ButtonLink>
          )
        }
      />
      {can('write') && p.status !== 'active' && <Review part={p} />}
      <div className="grid gap-4 md:grid-cols-2">
        {p.tracking === 'individual' ? (
          <Card title={t('units.title')} className="md:col-span-2">
            <UnitList units={p.units} />
            {canEdit && <AddUnits part={p} />}
          </Card>
        ) : (
          <>
            <Card title={t('part.where')} className="md:col-span-2">
              {p.lots.length === 0 ? (
                <span className="text-sm text-muted">{t('part.notInStock')}</span>
              ) : (
                <ul className="flex flex-col gap-3">
                  {p.lots.map((lot, i) => (
                    <LotRow
                      key={lot.id}
                      lot={lot}
                      canEdit={canEdit}
                      first={i === 0}
                      cut={p.cut}
                      unitMassG={p.unitMassG}
                      container={p.container}
                    />
                  ))}
                </ul>
              )}
            </Card>
            <div className="flex flex-wrap items-start gap-2 md:col-span-2 [&>form]:basis-full">
              {canEdit && <AddStock part={p} />}
              <ReportItem part={p} />
            </div>
          </>
        )}
        <Card title={t('part.identifiers')}>
          {p.identifiers.length === 0 ? (
            <span className="text-sm text-muted">{t('part.noIdentifiers')}</span>
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {p.identifiers.map((i) => (
                <div key={i.kind + i.value} className="contents">
                  <dt className="text-muted">{t(`identifierKinds.${i.kind}`)}</dt>
                  <dd className="font-mono text-[13px] break-all">{i.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {p.aliases.length > 0 && (
            <p className="text-[13px] text-muted">
              {t('part.alsoCalled', { names: p.aliases.join(', ') })}
            </p>
          )}
          {p.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.tags.map((tag) => (
                <ButtonLink key={tag} to={`/items?tag=${encodeURIComponent(tag)}`} small>
                  {tag}
                </ButtonLink>
              ))}
            </div>
          )}
        </Card>
        {Object.values(p.attributes).some((v) => v !== null && v !== '') && (
          <Card title={t('part.details')}>
            <AttributeList fields={p.fields} attributes={p.attributes} />
          </Card>
        )}
        <Files part={p} canEdit={canEdit} />
        {(p.description || p.notes || p.source || p.unitMassG || p.container) && (
          <Card title={t('part.notes')}>
            <dl className="flex flex-col gap-2 text-sm">
              {p.description && (
                <div>
                  <dt className="text-muted">{t('part.description')}</dt>
                  <dd className="whitespace-pre-wrap">{p.description}</dd>
                </div>
              )}
              {p.notes && (
                <div>
                  <dt className="text-muted">{t('part.notes')}</dt>
                  <dd className="whitespace-pre-wrap">{p.notes}</dd>
                </div>
              )}
              {p.source && (
                <div>
                  <dt className="text-muted">{t('part.source')}</dt>
                  <dd>{p.source}</dd>
                </div>
              )}
              {p.unitMassG != null && (
                <div>
                  <dt className="text-muted">{t('part.unitMass')}</dt>
                  <dd className="tabular">{p.unitMassG}</dd>
                </div>
              )}
              {p.container && (
                <div>
                  <dt className="text-muted">{t('container.title')}</dt>
                  <dd>
                    {[
                      p.container.name || t('amount.container'),
                      p.container.massG != null &&
                        t('container.emptyIs', { mass: p.container.massG }),
                      p.container.holds != null &&
                        t('container.holdsAmount', {
                          amount: `${p.container.holds} ${p.container.unit ? unitLabel(p.container.unit) : t('container.pieces')}`,
                        }),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}
        <Card title={t('part.history')}>
          {p.history.length === 0 ? (
            <Empty>{t('part.noHistory')}</Empty>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {p.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{t(`part.reasons.${h.reason}`, { defaultValue: h.reason })}</span>
                  <span className="tabular text-muted">
                    {h.delta != null && `${h.delta > 0 ? '+' : ''}${h.delta} · `}
                    {formatDate(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can('write') && p.status === 'active' && <Review part={p} />}
      </div>
      {can('inventory') && <LabelPanel code={p.code} version={part.dataUpdatedAt} fix="part" />}
    </>
  );
}
