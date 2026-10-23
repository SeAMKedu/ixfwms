import type { LocationNode } from '@ixfwms/domain';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLocationTree } from '../api/queries';
import { useSession } from '../auth/session';
import { Button, Card, CodeLabel, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { MapLayers } from '../components/svg-map';
import { NewPlaceForm } from './location';

function Node({ node, depth }: { node: LocationNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className="flex items-center gap-1 rounded-md py-1 hover:bg-surface-2"
        style={{ paddingLeft: `${depth * 1.1}rem` }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`grid size-6 place-items-center text-muted ${hasChildren ? '' : 'invisible'}`}
          aria-expanded={open}
          aria-label={node.name}
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </button>
        <Link
          to={`/l/${node.code}`}
          className="flex min-w-0 flex-1 items-center justify-between gap-2"
        >
          <span className={`truncate ${node.kind !== 'normal' ? 'text-muted italic' : ''}`}>
            {node.name}
          </span>
          <CodeLabel code={node.code} />
        </Link>
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function PlacesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const tree = useLocationTree();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title={t('places.title')}
        actions={
          can('inventory') && (
            <Button variant="primary" onClick={() => setAdding((a) => !a)}>
              <Plus className="size-4" aria-hidden />
              {t('places.newTopLevel')}
            </Button>
          )
        }
      />
      {adding && <NewPlaceForm parent={null} defaultType="room" onDone={() => setAdding(false)} />}
      <ErrorBox error={tree.error} />
      {tree.data
        ?.filter((n) => n.kind === 'normal')
        .map((n) => (
          <MapLayers key={n.id} code={n.code} />
        ))}
      {tree.isPending ? (
        <Loading />
      ) : (
        <Card>
          {tree.data && tree.data.filter((n) => n.kind === 'normal').length === 0 && (
            <Empty>{t('places.empty')}</Empty>
          )}
          <ul className="-mx-1">
            {tree.data?.map((n) => (
              <Node key={n.id} node={n} depth={0} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
