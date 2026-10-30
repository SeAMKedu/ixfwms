import type { LocationSummary, PartSummary } from '@ixfwms/domain';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PlaceTag } from '../../components/ui';
import { PlaceLink } from '../../components/units';

/** The places an item's stock is in, each with what's there. */
function stockPlaces(stock: PartSummary['stock']) {
  const out = new Map<string, { place: LocationSummary; amounts: string[] }>();
  for (const s of stock) {
    const entry = out.get(s.place.code) ?? { place: s.place, amounts: [] };
    entry.amounts.push(s.display);
    out.set(s.place.code, entry);
  }
  return [...out.values()];
}

/**
 * Where an item's stock is: the place, or for several "Multiple locations" that lists them on
 * hover, focus or tap. The list is fixed to the window so the table's scroll box doesn't clip it.
 */
export function StockWhere({ stock }: { stock: PartSummary['stock'] }) {
  const { t } = useTranslation();
  const places = stockPlaces(stock);
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  if (places.length === 0) return null;
  if (places.length === 1)
    return (
      <span className="text-[13px]">
        <PlaceLink place={places[0]!.place} />
      </span>
    );
  const show = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) setAt({ left: box.left, top: box.bottom });
  };
  return (
    <span
      className="inline-block"
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setAt(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setAt(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={!!at}
        className="text-[13px] underline decoration-dotted underline-offset-2"
        onClick={show}
      >
        {t('parts.multiplePlaces', { count: places.length })}
      </button>
      {at && (
        // Padding, not margin: the pointer stays inside on its way from the button to the list.
        <span className="fixed z-30 block pt-1" style={at}>
          <ul className="max-h-72 max-w-sm overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {places.map(({ place, amounts }) => (
              <li key={place.code}>
                <Link
                  to={`/l/${place.code}`}
                  className="flex items-center justify-between gap-4 px-3 py-1 text-[13px] hover:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{place.name}</span>
                    <PlaceTag place={place} />
                  </span>
                  <span className="shrink-0 text-muted tabular">{amounts.join(', ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}
