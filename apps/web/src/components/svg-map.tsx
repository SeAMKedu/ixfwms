import { codeFromElementId, type MapLayer } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMapLayers } from '../api/queries';
import { Card, ErrorBox, Loading } from './ui';

/** Drawings can come from anywhere, so scripts, event handlers and external references are stripped. */
function sanitize(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'use'],
  });
}

/**
 * One drawing. Elements with ids like "loc:A3F9" become clickable and open that place;
 * codes in `highlight` light up, the last one (the place you're looking for) strongest.
 */
export function SvgMap({
  href,
  highlight,
  title,
}: {
  href: string;
  highlight: string[];
  title: string;
}) {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const svg = useQuery({
    queryKey: ['svg', href],
    queryFn: async () => (await fetch(href)).text(),
    staleTime: Infinity,
  });
  const clean = useMemo(() => (svg.data ? sanitize(svg.data) : ''), [svg.data]);

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
    const present = new Set<string>();
    for (const el of root.querySelectorAll<SVGElement>('[id]')) {
      const code = codeFromElementId(el.id);
      if (!code) continue;
      present.add(code);
      el.dataset.ixfCode = code;
      el.classList.add('ixf-place');
      el.classList.toggle('ixf-hit', highlight.includes(code));
    }
    const target = [...highlight].reverse().find((c) => present.has(c));
    if (target) root.querySelector(`[data-ixf-code="${target}"]`)?.classList.add('ixf-target');
  }, [clean, highlight, title]);

  if (svg.isPending) return <Loading />;
  if (svg.error) return <ErrorBox error={svg.error} />;
  return (
    <div
      ref={box}
      className="ixf-map overflow-hidden rounded-lg border border-line bg-white"
      onClick={(e) => {
        const el = (e.target as Element).closest<SVGElement>('[data-ixf-code]');
        if (el?.dataset.ixfCode) void navigate(`/l/${el.dataset.ixfCode}`);
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
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
        <figure key={l.location.id} className="flex flex-col gap-1.5">
          <SvgMap href={l.href} highlight={l.highlight} title={l.location.name} />
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
