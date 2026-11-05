import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { LocationSummary } from '../../modules/locations/store.js';
import { parse, type AppDeps } from '../context.js';

/*
 * Minimal read-only pages, so QR labels scanned with a phone camera land somewhere useful
 * before the real web UI (0.2) exists. Plain HTML, no scripts.
 */

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const STYLE = `
:root{color-scheme:light dark;--bg:#eef1f2;--fg:#15202a;--muted:#586672;--line:#d5dce0;--card:#fff;--link:#1d5ea8}
@media (prefers-color-scheme:dark){:root{--bg:#0e1317;--fg:#e4e9ec;--muted:#94a3ad;--line:#2a3640;--card:#161e25;--link:#7cb2ee}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left))}
a{color:var(--link);text-decoration:none}
h1{font-size:24px;margin:4px 0 2px}
.path{color:var(--muted);font-size:13px}
.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;border:1px solid var(--line);background:#fff;color:#111;padding:0 5px;border-radius:2px}
ul{list-style:none;padding:0;margin:8px 0;background:var(--card);border:1px solid var(--line);border-radius:8px}
li{padding:9px 12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px}
li:first-child{border-top:0}
small{color:var(--muted)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:20px 0 4px}
form{display:flex;gap:8px;margin:12px 0}
input{flex:1;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:var(--link);color:#fff}
.note{color:var(--muted);font-size:13px;margin-top:24px}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)} · ixfwms</title><style>${STYLE}</style></head><body><main>${body}<p class="note"><a href="/">ixfwms</a> · read-only preview, the full web app comes in 0.2</p></main></body></html>`;
}

const crumbs = (path: LocationSummary[]) =>
  path.map((p) => `<a href="/l/${esc(p.code)}">${esc(p.name)}</a>`).join(' › ');

export function registerPageRoutes(app: FastifyInstance, { services }: AppDeps): void {
  const { locations, locationViews, parts } = services;

  app.get('/', async (request, reply) => {
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), request.query);
    let results = '';
    if (q) {
      const found = await parts.search({ q, limit: 50, offset: 0 });
      const byId = new Map(found.items.map((p) => [p.id, p]));
      const buildById = new Map(found.builds.map((b) => [b.id, b]));
      results = `<h2>${found.total} result(s)</h2><ul>${found.rows
        .map((row) => {
          if ('buildId' in row) {
            const b = buildById.get(row.buildId)!;
            return `<li><span><a href="/l/${esc(b.code)}">${esc(b.name)}</a><br><small>build</small></span><small>${esc(b.in?.name ?? '')}</small></li>`;
          }
          const p = byId.get(row.partId)!;
          const u = row.unitId ? p.units.find((x) => x.id === row.unitId) : undefined;
          if (u)
            return `<li><span><a href="/u/${esc(u.code)}">${esc(u.name)}</a><br><small>${esc(p.manufacturer ?? '')} ${esc(u.serialNo ?? '')}</small></span><small>${esc(u.location.name)}</small></li>`;
          return `<li><span><a href="/p/${esc(p.code)}">${esc(p.name)}</a><br><small>${esc(p.manufacturer ?? '')} ${esc(p.identifiers[0]?.value ?? '')}</small></span><small>${esc(p.stock.map((s) => `${s.display} @ ${s.locationCode}`).join(', '))}</small></li>`;
        })
        .join('')}</ul>`;
    }
    const top = await locations.children(null);
    const body = `<h1>ixfwms</h1><form method="get" action="/"><input name="q" value="${esc(q ?? '')}" placeholder="Search parts, order numbers…" aria-label="Search"><button>Search</button></form>${results}<h2>Places</h2><ul>${top
      .map(
        (l) =>
          `<li><a href="/l/${esc(l.code)}">${esc(l.name)}</a><span class="code">${esc(l.code)}</span></li>`,
      )
      .join('')}</ul>`;
    return reply.type('text/html; charset=utf-8').send(page('Search', body));
  });

  const locationPage = async (code: string) => {
    const d = await locationViews.detail(code, { recursive: true });
    const children = d.children.length
      ? `<h2>Inside</h2><ul>${d.children
          .map(
            (c) =>
              `<li><a href="/l/${esc(c.code)}">${esc(c.name)}</a><small>${c.partCount} parts · <span class="code">${esc(c.code)}</span></small></li>`,
          )
          .join('')}</ul>`
      : '';
    const contents = d.contents.length
      ? `<h2>Contents</h2><ul>${d.contents
          .map(
            (c) =>
              `<li><span><a href="/p/${esc(c.part.code)}">${esc(c.part.name)}</a>${c.part.status === 'draft' ? ' <small>(draft)</small>' : ''}${c.in ? `<br><small>in ${esc(c.in.name)}</small>` : ''}</span><small>${esc(c.display)}</small></li>`,
          )
          .join('')}</ul>`
      : '<p><small>Nothing stored here yet.</small></p>';
    return page(
      d.name,
      `<div class="path">${crumbs(d.path.slice(0, -1))}</div><h1>${esc(d.name)} <span class="code">${esc(d.code)}</span></h1>${d.description ? `<p>${esc(d.description)}</p>` : ''}${children}${contents}`,
    );
  };

  const partPage = async (code: string) => {
    const p = await parts.get(code);
    const lots = p.lots.length
      ? `<ul>${p.lots
          .map(
            (l) =>
              `<li><span class="path">${crumbs(l.path)}</span><small>${esc(l.display)}${l.estimatedCount != null && l.amount.mode === 'measure' ? ` ≈ ${l.estimatedCount} pcs` : ''}</small></li>`,
          )
          .join('')}</ul>`
      : '<p><small>Not in stock anywhere.</small></p>';
    const idents = p.identifiers
      .map((i) => `${esc(i.value)} <small>(${esc(i.kind)})</small>`)
      .join('<br>');
    const files = p.attachments.length
      ? `<h2>Files &amp; links</h2><ul>${p.attachments
          .map(
            (a) =>
              `<li><a href="${esc(a.href)}">${esc(a.title ?? a.file?.filename ?? a.href)}</a><small>${esc(a.kind)}</small></li>`,
          )
          .join('')}</ul>`
      : '';
    return page(
      p.name,
      `<div class="path">${esc(p.category ?? '')}</div><h1>${esc(p.name)} <span class="code">${esc(p.code)}</span></h1><p><small>${esc(p.manufacturer ?? '')}${p.status === 'draft' ? ' · draft, not reviewed yet' : ''}</small><br>${idents}</p><h2>Where</h2>${lots}${files}${p.description ? `<h2>Description</h2><p>${esc(p.description)}</p>` : ''}`,
    );
  };

  const render =
    (fn: (code: string) => Promise<string>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code } = parse(z.object({ code: z.string() }), request.params);
      try {
        return reply.type('text/html; charset=utf-8').send(await fn(code));
      } catch (err) {
        if (err instanceof AppError && err.code === 'not_found') {
          return reply
            .status(404)
            .type('text/html; charset=utf-8')
            .send(
              page(
                'Not found',
                `<h1>Unknown code <span class="code">${esc(code)}</span></h1><p>This label isn't assigned yet, or it was mistyped.</p>`,
              ),
            );
        }
        throw err;
      }
    };

  for (const prefix of ['l', 'L']) app.get(`/${prefix}/:code`, render(locationPage));
  for (const prefix of ['p', 'P']) app.get(`/${prefix}/:code`, render(partPage));
}
