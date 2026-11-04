import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useLocation, useMapLayers, usePick } from '../api/queries';
import { useSession } from '../auth/session';
import { useShortcut } from '../lib/shortcuts';
import { useTypeName } from '../lib/place-types';
import { placeTag } from '../lib/places';
import { LabelPanel } from '../components/label-panel';
import { LoanNote } from '../components/loans';
import { MapManager } from '../components/map-manager';
import { MapLayers } from '../components/svg-map';
import {
  Button,
  Card,
  ErrorBox,
  Loading,
  LocationPath,
  PageHeader,
  Pill,
  PlaceTag,
  isNotFound,
} from '../components/ui';
import { BuildPanel } from './location/build-panel';
import { ClearBench } from './location/clear-bench';
import { NewPlaceForm, Missing, NEXT_TYPE } from './location/new-place';
import { TemporaryNote } from './location/temporary-note';
import { CopyPlaceForm } from './location/copy-place';
import { EditPlaceForm, MovePlaceForm } from './location/edit-place';
import { PlaceActions, type Panel } from './location/actions';
import { ArchivedList, ArchivedNote, ChildList, ContentList } from './location/contents';
import { LendPlaceForm, ReturnPlaceForm } from './location/loan';

export function LocationPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const [recursive, setRecursive] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const loc = useLocation(code, recursive);
  const layers = useMapLayers(code);
  const pick = usePick();
  const typeName = useTypeName();

  /** Opens (or closes) the edit/move/copy panel; the forms prefill from the place when they open. */
  const openPanel = (p: Panel) => {
    if (!loc.data) return;
    setPanel((cur) => (cur === p ? null : p));
  };
  const navigate = useNavigate();
  const editable =
    can('inventory') &&
    loc.data?.kind === 'normal' &&
    !loc.data.dismantledAt &&
    !loc.data.archivedAt;
  // Nothing goes into or out of a container lent out of the lab.
  const inLab = editable && !loc.data?.outOfLab;
  useShortcut('a', t('shortcuts.addItems'), () => void navigate(`/l/${code}/add`), inLab);
  useShortcut('e', t('shortcuts.editPlace'), () => openPanel('edit'), editable);
  useShortcut('m', t('shortcuts.movePlace'), () => openPanel('move'), inLab);
  useShortcut('d', t('shortcuts.copyPlace'), () => openPanel('copy'), editable);
  useShortcut('p', t('shortcuts.pickUp'), () => pick.mutate({ location: code }), inLab);
  if (loc.isPending) return <Loading />;
  if (isNotFound(loc.error)) return <Missing code={code} />;
  if (!loc.data) return <ErrorBox error={loc.error} />;
  const d = loc.data;
  const canEdit = can('inventory') && d.kind === 'normal' && !d.dismantledAt && !d.archivedAt;
  const canChange = canEdit && !d.outOfLab;
  const lentHere = can('inventory') && d.loan?.place?.code === d.code;
  const hasMap = (layers.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        eyebrow={d.path.length > 1 && <LocationPath path={d.path.slice(0, -1)} linkLast={false} />}
        title={d.name}
        qr={d.kind === 'normal' ? d.code : undefined}
        meta={
          <>
            <PlaceTag place={d} />
            {d.movable && d.within && <span>{t('places.within', { address: d.within })}</span>}
            <span>{typeName(d.type)}</span>
            {d.dismantledAt && <Pill tone="warn">{t('builds.dismantledPill')}</Pill>}
            {d.archivedAt && <Pill tone="muted">{t('archive.archivedPill')}</Pill>}
            {placeTag(d) !== d.code && (
              <span className="font-mono text-[12px]" title={t('places.codeHint')}>
                {d.code}
              </span>
            )}
          </>
        }
        actions={
          canEdit && (
            <PlaceActions
              place={d}
              panel={panel}
              openPanel={openPanel}
              canChange={canChange}
              lentHere={lentHere}
              pick={pick}
            />
          )
        }
      />
      {d.loan && <LoanNote loan={d.loan} code={d.code} />}
      {d.archivedAt && <ArchivedNote place={d} />}
      {d.hint && (
        <p className="max-w-prose text-sm">
          <span className="text-muted">{t('places.hint')}: </span>
          {d.hint}
        </p>
      )}
      {d.description && <p className="max-w-prose whitespace-pre-wrap text-sm">{d.description}</p>}
      {d.stayDays !== null && <TemporaryNote place={d} canEdit={canEdit} />}
      {d.clashes.length > 0 && (
        <p className="max-w-prose rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {t('places.clash', {
            address: d.address,
            names: d.clashes.map((c) => c.name).join(', '),
          })}
        </p>
      )}
      <ErrorBox error={pick.error} />

      {panel === 'edit' && <EditPlaceForm place={d} onDone={() => setPanel(null)} />}
      {panel === 'move' && <MovePlaceForm place={d} onDone={() => setPanel(null)} />}
      {panel === 'copy' && <CopyPlaceForm place={d} onDone={() => setPanel(null)} />}
      {panel === 'lend' && <LendPlaceForm place={d} onDone={() => setPanel(null)} />}
      {panel === 'return' && <ReturnPlaceForm place={d} onDone={() => setPanel(null)} />}

      <div
        className={
          hasMap ? 'grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start' : ''
        }
      >
        <div
          className={
            hasMap
              ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-1'
              : 'grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'
          }
        >
          <Card
            title={t('places.inside')}
            actions={
              canChange && (
                <Button
                  small
                  variant="ghost"
                  onClick={() => setPanel(panel === 'new' ? null : 'new')}
                >
                  <Plus className="size-4" aria-hidden />
                  {t('places.newInside')}
                </Button>
              )
            }
          >
            {panel === 'new' && (
              <NewPlaceForm
                parent={d.code}
                defaultType={NEXT_TYPE[d.type] ?? 'box'}
                onDone={() => setPanel(null)}
              />
            )}
            {d.children.length === 0 ? (
              panel !== 'new' && <span className="text-sm text-muted">—</span>
            ) : (
              <ChildList place={d} />
            )}
            {d.archived.length > 0 && <ArchivedList place={d} />}
          </Card>
          <Card
            title={t('places.contents')}
            actions={
              d.children.length > 0 && (
                <label className="flex items-center gap-1.5 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={recursive}
                    onChange={(e) => setRecursive(e.target.checked)}
                  />
                  {t('places.includeSub')}
                </label>
              )
            }
          >
            <ContentList place={d} />
          </Card>
        </div>
        {hasMap && (
          <MapLayers
            code={d.code}
            layers={layers.data}
            collapsible
            className="lg:sticky lg:top-4"
          />
        )}
      </div>
      {d.workstation && <ClearBench place={d} />}
      {d.build && <BuildPanel place={d} canEdit={canChange} />}
      {canEdit && layers.data && (
        <MapManager code={d.code} layers={layers.data.filter((l) => l.location.code === d.code)} />
      )}
      {d.kind === 'normal' && can('inventory') && (
        <LabelPanel
          code={d.code}
          version={loc.dataUpdatedAt}
          csvHref={`/api/labels.csv?location=${d.code}&recursive=1`}
          fix="location"
        />
      )}
    </>
  );
}
