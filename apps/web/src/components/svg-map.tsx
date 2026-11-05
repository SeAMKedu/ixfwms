import type { MapKind, MapLayer } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { Map as MapIcon, Maximize2, Minimize2, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMapLayers } from '../api/maps';
import { Button, ErrorBox, Loading } from './ui';

/** three.js is large, so the 3D viewer loads only when a 3D map is shown. */
const ModelMap = lazy(() => import('./model-map'));

/** Picking shapes to link instead of opening places. */
export interface MapEditing {
  selected: string | null;
  /** The picked shape, and the shapes around it (innermost first) for stepping out to a group. */
  onSelect: (key: string | null, parents: string[]) => void;
}

const STATE_CLASSES = [
  'ixf-place',
  'ixf-hit',
  'ixf-target',
  'ixf-linked',
  'ixf-selected',
  'ixf-attention',
];

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
  focus = false,
  onZoomable,
  attention = [],
}: {
  href: string;
  highlight: string[];
  /** Places to mark amber (an overdue temporary place, or something holding one). */
  attention?: string[];
  links: Record<string, string>;
  title: string;
  editing?: MapEditing;
  /** Zoom in around the place being looked for instead of showing the whole drawing. */
  focus?: boolean;
  /** Told whether zooming in around the place makes a difference (it doesn't on a small drawing). */
  onZoomable?: (zoomable: boolean) => void;
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
      el.classList.toggle('ixf-attention', attention.includes(code));
      if (highlight.includes(code)) {
        el.classList.add('ixf-hit');
        if (!target || highlight.indexOf(code) > highlight.indexOf(target.dataset.ixfCode!))
          target = el;
      }
    }
    target?.classList.add('ixf-target');
    const zoomable = zoom(root, isEditing ? null : target, focus);
    onZoomable?.(zoomable);
  }, [clean, highlight, links, title, isEditing, selected, focus, onZoomable, attention]);

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

/**
 * Shows the whole drawing, or the area around `target` (a little context around it, at least a
 * third of the drawing, same proportions as the drawing so nothing jumps).
 */
function zoom(root: SVGSVGElement, target: SVGElement | null, apply: boolean): boolean {
  const full = (root.dataset.ixfViewBox ??= root.getAttribute('viewBox') ?? '');
  if (full) root.setAttribute('viewBox', full);
  const [fx, fy, fw, fh] = full.split(/[\s,]+/).map(Number) as [number, number, number, number];
  const box = root.getBoundingClientRect();
  const hit = target?.getBoundingClientRect();
  if (!target || !hit || !full || !fw || !fh || !box.width || !hit.width) return false;
  // Screen pixels → drawing units (the viewBox is scaled uniformly to fit the element).
  const scale = Math.max(fw / box.width, fh / box.height);
  const offsetX = (box.width - fw / scale) / 2;
  const offsetY = (box.height - fh / scale) / 2;
  const cx = fx + (hit.left - box.left - offsetX + hit.width / 2) * scale;
  const cy = fy + (hit.top - box.top - offsetY + hit.height / 2) * scale;
  let w = Math.max(hit.width * scale * 3, fw / 3);
  let h = Math.max(hit.height * scale * 3, fh / 3);
  if (w / h < fw / fh) w = (h * fw) / fh;
  else h = (w * fh) / fw;
  if (w >= fw * 0.9 || h >= fh * 0.9) return false;
  if (!apply) return true;
  const x = Math.min(Math.max(cx - w / 2, fx), fx + fw - w);
  const y = Math.min(Math.max(cy - h / 2, fy), fy + fh - h);
  root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  return true;
}

/** One layer, 2D or 3D. */
export function MapView({
  layer,
  editing,
  focus,
  tall,
  onZoomable,
}: {
  layer: MapLayer;
  editing?: MapEditing;
  focus?: boolean;
  onZoomable?: (zoomable: boolean) => void;
  /** Expanded to fill the screen. */
  tall?: boolean;
}) {
  return layer.kind === 'gltf_3d' ? (
    <Suspense fallback={<Loading />}>
      <ModelMap
        href={layer.href}
        highlight={layer.highlight}
        links={layer.links}
        title={layer.location.name}
        editing={editing}
        tall={tall}
        attention={layer.attention}
      />
    </Suspense>
  ) : (
    <SvgMap
      href={layer.href}
      highlight={layer.highlight}
      links={layer.links}
      title={layer.location.name}
      editing={editing}
      focus={focus}
      onZoomable={onZoomable}
      attention={layer.attention}
    />
  );
}

const KIND_KEY = 'ixfwms.mapKind';
const readKind = (): MapKind | null => {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === 'svg_2d' || v === 'gltf_3d' ? v : null;
  } catch {
    return null;
  }
};

/**
 * "Show me where": one map at a time, with a tab per level on the way down (lab, cabinet…) and a
 * 2D/3D switch. Opens on the most detailed level that shows the place, zoomed in around it.
 * With `collapsible`, phones get a Map button instead of the map.
 */
export function MapLayers({
  code,
  layers: given,
  collapsible = false,
  className,
}: {
  code: string;
  layers?: MapLayer[];
  collapsible?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const fetched = useMapLayers(given ? '' : code);
  const layers = useMemo(() => given ?? fetched.data ?? [], [given, fetched.data]);
  const [open, setOpen] = useState(
    () => !collapsible || window.matchMedia('(min-width: 1024px)').matches,
  );
  const [levelId, setLevelId] = useState<string | null>(null);
  const [kind, setKind] = useState<MapKind | null>(readKind);
  const [whole, setWhole] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoomable, setZoomable] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const levels = [...new Map(layers.map((l) => [l.location.id, l.location])).values()];
  if (levels.length === 0) return null;
  const pointsHere = (id: string) => layers.some((l) => l.location.id === id && l.highlight.length);
  const fallback =
    [...levels].reverse().find((l) => pointsHere(l.id)) ?? levels[levels.length - 1]!;
  const level = levels.find((l) => l.id === levelId) ?? fallback;
  const here = layers.filter((l) => l.location.id === level.id);
  const layer = here.find((l) => l.kind === kind) ?? here[0]!;
  const chooseKind = (k: MapKind) => {
    setKind(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {
      // remembered for this visit only
    }
  };
  const tab = (active: boolean) =>
    `rounded-md px-2 py-1 text-[13px] whitespace-nowrap ${active ? 'bg-ink text-surface' : 'text-muted hover:bg-surface-2'}`;

  if (!open)
    return (
      <Button small className="self-start" onClick={() => setOpen(true)}>
        <MapIcon className="size-4" aria-hidden />
        {t('maps.showOnMap')}
      </Button>
    );
  return (
    <section
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col gap-2 overflow-auto bg-surface p-3'
          : `flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3 ${className ?? ''}`
      }
      aria-label={t('maps.title')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 gap-1 overflow-x-auto" role="tablist">
          {levels.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === level.id}
              className={tab(l.id === level.id)}
              onClick={() => setLevelId(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {here.length > 1 &&
            here.map((l) => (
              <button
                key={l.kind}
                type="button"
                aria-pressed={l.kind === layer.kind}
                className={tab(l.kind === layer.kind)}
                onClick={() => chooseKind(l.kind)}
              >
                {t(`maps.short.${l.kind}`)}
              </button>
            ))}
          {layer.kind === 'svg_2d' && zoomable && (
            <Button small variant="ghost" onClick={() => setWhole(!whole)}>
              {t(whole ? 'maps.zoomIn' : 'maps.whole')}
            </Button>
          )}
          <Button
            small
            variant="ghost"
            aria-label={t(expanded ? 'maps.shrink' : 'maps.expand')}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 className="size-4" aria-hidden />
            ) : (
              <Maximize2 className="size-4" aria-hidden />
            )}
          </Button>
          {collapsible && !expanded && (
            <Button
              small
              variant="ghost"
              aria-label={t('common.close')}
              className="lg:hidden"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <div className={expanded ? 'ixf-expanded min-h-0 flex-1' : ''}>
        <MapView
          key={`${layer.location.id}-${layer.kind}`}
          layer={layer}
          focus={!whole}
          tall={expanded}
          onZoomable={setZoomable}
        />
      </div>
      {layer.location.code !== code && (
        <Link to={`/l/${layer.location.code}`} className="text-[12px] text-muted hover:underline">
          {layer.location.name}
        </Link>
      )}
    </section>
  );
}
