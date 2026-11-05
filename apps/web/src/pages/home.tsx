import type { PartSummary, PlaceStep, WhereIsAnswer } from '@ixfwms/domain';
import { AlertTriangle, ScanLine, Search } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useCategories } from '../api/categories';
import { useMapDrawings } from '../api/maps';
import { useParts } from '../api/parts';
import { useWhere } from '../api/where';
import { useSession } from '../auth/session';
import { MapLayers } from '../components/svg-map';
import { Empty, ErrorBox, Loading } from '../components/ui';

/**
 * The front page. Without an account: "What are you looking for?", answered with where things
 * are and how to find them, plus Scan, Report a problem, categories and the lab map. Logged in,
 * or with a search in the address (old `/?q=` links), it is the Items list.
 */
export function HomePage() {
  const { user, checking } = useSession();
  const { search } = useLocation();
  if (user || search) return <Navigate to={`/items${search}`} replace />;
  // A stored login is still being checked: don't show the guest page to someone logged in.
  if (checking) return <Loading />;
  return <GuestHome />;
}

function GuestHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const typing = useRef<number | undefined>(undefined);
  const onType = (value: string) => {
    setText(value);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => setQ(value.trim()), 250);
  };
  // On a phone the keyboard would cover the page before anyone has chosen to type.
  const [wide] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? false);
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-2xl font-bold md:text-3xl">{t('home.title')}</h1>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void navigate(`/items?q=${encodeURIComponent(text.trim())}`);
          }}
        >
          <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 focus-within:border-link">
            <Search className="size-5 shrink-0 text-muted" aria-hidden />
            <input
              type="search"
              value={text}
              onChange={(e) => onType(e.target.value)}
              autoFocus={wide}
              data-shortcut-search
              aria-label={t('parts.searchLabel')}
              placeholder={t('home.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
            />
          </label>
        </form>
        {q ? (
          <Answers q={q} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Tile to="/scan" icon={<ScanLine className="size-6" aria-hidden />}>
                <span className="font-semibold">{t('home.scan')}</span>
                <span className="text-[13px] text-muted">{t('home.scanHint')}</span>
              </Tile>
              <Tile to="/scan" icon={<AlertTriangle className="size-6" aria-hidden />}>
                <span className="font-semibold">{t('home.report')}</span>
                <span className="text-[13px] text-muted">{t('home.reportHint')}</span>
              </Tile>
            </div>
            <Categories />
          </>
        )}
      </div>
      <LabMap />
    </div>
  );
}

function Tile({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3 hover:border-link"
    >
      <span className="text-link">{icon}</span>
      {children}
    </Link>
  );
}

/** What the search found: each thing, how much, and the way to it. */
function Answers({ q }: { q: string }) {
  const { t } = useTranslation();
  const where = useWhere(q);
  const parts = useParts({ q, limit: 5 });
  if (where.error) return <ErrorBox error={where.error} />;
  if (!where.data) return <Loading />;
  const items = new Map((parts.data?.items ?? []).map((i) => [i.code, i]));
  return (
    <div className="flex flex-col gap-2">
      {where.data.length === 0 && <Empty>{t('home.nothing')}</Empty>}
      {where.data.map((a) => (
        <Answer key={`${a.item.code}-${a.unit ?? ''}`} answer={a} item={items.get(a.item.code)} />
      ))}
      <Link to={`/items?q=${encodeURIComponent(q)}`} className="text-sm text-link">
        {t('home.allItems')}
      </Link>
    </div>
  );
}

function Answer({ answer, item }: { answer: WhereIsAnswer; item?: PartSummary }) {
  const { t } = useTranslation();
  const unit = answer.unit ? item?.units.find((u) => u.code === answer.unit) : undefined;
  const to =
    answer.item.kind === 'build'
      ? `/l/${answer.item.code}`
      : answer.unit
        ? `/u/${answer.unit}`
        : `/p/${answer.item.code}`;
  const amount = !answer.unit && item?.stock.length ? item.stock[0]!.display : null;
  const more = !answer.unit && item ? item.stock.length - 1 : 0;
  // Without directions (lent out, being carried, no stock): where the search says it is.
  const fallback = unit
    ? unit.location.name
    : item?.stock.length
      ? item.stock[0]!.location
      : t('home.noneInStock');
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-3 py-2.5 hover:border-link"
    >
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{unit?.name ?? answer.item.name}</span>
        {amount && <span className="text-[13px] text-muted">{amount}</span>}
        {more > 0 && (
          <span className="text-[13px] text-muted">{t('home.morePlaces', { count: more })}</span>
        )}
      </span>
      <span className="text-[14px] text-ink">
        {answer.directions?.length ? <Directions steps={answer.directions} /> : fallback}
      </span>
    </Link>
  );
}

/** "Robotics lab › Cabinet B, grey cabinet by the project bench › Shelf 2 (2 of 5 from the bottom)". */
function Directions({ steps }: { steps: PlaceStep[] }) {
  const { t } = useTranslation();
  return (
    <>
      {steps.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted"> › </span>}
          {s.name}
          {s.hint && <span className="text-muted">, {s.hint}</span>}
          {s.position && (
            <span className="text-muted">
              {' '}
              {t('home.position', {
                n: s.position.n,
                of: s.position.of,
                from: t(`home.from.${s.position.from}`),
              })}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

/** The biggest top-level categories, as shortcuts into the Items list. */
function Categories() {
  const { t } = useTranslation();
  const top = (useCategories().data ?? [])
    .filter((c) => !c.path.includes('/') && c.parts > 0)
    .sort((a, b) => b.parts - a.parts)
    .slice(0, 10);
  if (!top.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('home.browse')}>
      <h2 className="text-[13px] text-muted">{t('home.browse')}</h2>
      <div className="flex flex-wrap gap-2">
        {top.map((c) => (
          <Link
            key={c.path}
            to={`/items?category=${encodeURIComponent(c.path)}`}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] hover:border-link"
          >
            {c.path}
          </Link>
        ))}
        <Link to="/items" className="px-1 py-1 text-[13px] text-link">
          {t('home.allItems')}
        </Link>
      </div>
    </section>
  );
}

/** The map of the place addresses start at (the lab), or of a top-level place, if one has a map. */
function LabMap() {
  const usages = (useMapDrawings().data ?? []).flatMap((d) => d.usages.map((u) => u.location));
  const place =
    usages.find((l) => l.addressRoot) ?? usages.find((l) => l.within === '') ?? undefined;
  if (!place) return null;
  return <MapLayers code={place.code} collapsible className="lg:sticky lg:top-8" />;
}
