import type { MapLayer } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMapLayers } from '../api/queries';
import { Card, ErrorBox, Loading } from './ui';

/** three.js is large, so the 3D viewer loads only when a 3D map is shown. */
const ModelMap = lazy(() => import('./model-map'));

/** Picking shapes to link instead of opening places. */
export interface MapEditing {
  selected: string | null;
  /** The picked shape, and the shapes around it (innermost first) for stepping out to a group. */
  onSelect: (key: string | null, parents: string[]) => void;
}

const STATE_CLASSES = ['ixf-place', 'ixf-hit', 'ixf-target', 'ixf-linked', 'ixf-selected'];

/** Drawings can come from anywhere, so scripts, event handlers and external references are stripped. */
function sanitize(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'use'],
  });
}

/**
 * One drawing. Shapes linked to places (`links`: element id → place code) are clickable and open
 * that place; codes in `highlight` light up, the last one (the place you're looking for) strongest.
 * With `editing`, any shape with an id can be picked instead.
 */
export function SvgMap({
  href,
  highlight,
  links,
  title,
  editing,
}: {
  href: string;
  highlight: string[];
  links: Record<string, string>;
  title: string;
  editing?: MapEditing;
}) {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const svg = useQuery({
    queryKey: ['svg', href],
    queryFn: async () => (await fetch(href)).text(),
    staleTime: Infinity,
  });
  const clean = useMemo(() => (svg.data ? sanitize(svg.data) : ''), [svg.data]);
  const selected = editing?.selected ?? null;
  const isEditing = !!editing;

  useEffect(() => {
    const root = box.current?.querySelector('svg');
    if (!root) return;
    // Let the drawing scale to the card; its viewBox keeps the proportions.
    if (!root.getAttribute('viewBox')) {
      const w = parseFloat(root.getAttribute('width') ?? '');
      const h = parseFloat(root.getAttribute('height') ?? '');
      if (w && h) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    root.removeAttribute('width');
    root.removeAttribute('height');
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', title);
    let target: SVGElement | null = null;
    for (const el of root.querySelectorAll<SVGElement>('[id]')) {
      el.classList.remove(...STATE_CLASSES);
      delete el.dataset.ixfCode;
      const code = links[el.id];
      if (isEditing) {
        el.classList.toggle('ixf-linked', !!code);
        el.classList.toggle('ixf-selected', el.id === selected);
        continue;
      }
      if (!code) continue;
      el.dataset.ixfCode = code;
      el.classList.add('ixf-place');
      if (highlight.includes(code)) {
        el.classList.add('ixf-hit');
        if (!target || highlight.indexOf(code) > highlight.indexOf(target.dataset.ixfCode!))
          target = el;
      }
    }
    target?.classList.add('ixf-target');
  }, [clean, highlight, links, title, isEditing, selected]);

  if (svg.isPending) return <Loading />;
  if (svg.error) return <ErrorBox error={svg.error} />;
  return (
    <div
      ref={box}
      className={`ixf-map overflow-hidden rounded-lg border border-line bg-white${editing ? ' ixf-editing' : ''}`}
      onClick={(e) => {
        const root = box.current?.querySelector('svg');
        if (editing) {
          const keys: string[] = [];
          for (let el = (e.target as Element).closest('[id]'); el && el !== root;) {
            if (!root?.contains(el)) break;
            keys.push(el.id);
            el = el.parentElement?.closest('[id]') ?? null;
          }
          editing.onSelect(keys[0] ?? null, keys.slice(1));
          return;
        }
        const el = (e.target as Element).closest<SVGElement>('[data-ixf-code]');
        if (el?.dataset.ixfCode) void navigate(`/l/${el.dataset.ixfCode}`);
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/** One layer, 2D or 3D. */
export function MapView({ layer, editing }: { layer: MapLayer; editing?: MapEditing }) {
  return layer.kind === 'gltf_3d' ? (
    <Suspense fallback={<Loading />}>
      <ModelMap
        href={layer.href}
        highlight={layer.highlight}
        links={layer.links}
        title={layer.location.name}
        editing={editing}
      />
    </Suspense>
  ) : (
    <SvgMap
      href={layer.href}
      highlight={layer.highlight}
      links={layer.links}
      title={layer.location.name}
      editing={editing}
    />
  );
}

/** "Show me where": every drawing on the way down to a place, top level first. */
export function MapLayers({ code, layers: given }: { code: string; layers?: MapLayer[] }) {
  const { t } = useTranslation();
  const fetched = useMapLayers(given ? '' : code);
  const layers = given ?? fetched.data;
  if (!given && fetched.isPending) return null;
  if (!layers || layers.length === 0) return null;
  return (
    <Card title={t('maps.title')}>
      {layers.map((l) => (
        <figure key={`${l.location.id}-${l.kind}`} className="flex flex-col gap-1.5">
          <MapView layer={l} />
          <figcaption className="text-[12px] text-muted">
            <Link to={`/l/${l.location.code}`} className="hover:underline">
              {l.location.name}
            </Link>
          </figcaption>
        </figure>
      ))}
    </Card>
  );
}
