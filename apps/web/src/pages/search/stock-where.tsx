import type { LocationSummary, PartSummary } from '@ixfwms/domain';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AmountPill, AmountsPill } from '../../components/ui';
import { PlaceCell, PlaceLabel } from '../../components/units';

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
 * A short label that lists an item's stock, place by place, on hover, focus or tap. The list is
 * fixed to the window so the table's scroll box doesn't clip it.
 */
function StockPopup({
  label,
  stock,
  alignRight,
}: {
  label: ReactNode;
  stock: PartSummary['stock'];
  /** Open leftwards from the label's right edge, for a label near the side of the window. */
  alignRight?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left?: number; right?: number; top: number } | null>(null);
  const show = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    setAt(
      alignRight
        ? { right: document.documentElement.clientWidth - box.right, top: box.bottom }
        : { left: box.left, top: box.bottom },
    );
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
        className="text-[13px] whitespace-nowrap underline decoration-dotted underline-offset-2"
        onClick={show}
      >
        {label}
      </button>
      {at && (
        // Padding, not margin: the pointer stays inside on its way from the button to the list.
        <span className="fixed z-30 block pt-1" style={at}>
          <ul className="max-h-72 max-w-sm overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {stockPlaces(stock).map(({ place, amounts }) => (
              <li key={place.code}>
                <Link
                  to={`/l/${place.code}`}
                  className="flex items-center justify-between gap-4 px-3 py-1 text-[13px] hover:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <PlaceLabel place={place} />
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {amounts.map((amount, i) => (
                      <AmountPill key={i} display={amount} />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

/** Where an item's stock is: the place, or for several "Multiple locations" that lists them. */
export function StockWhere({ stock }: { stock: PartSummary['stock'] }) {
  const { t } = useTranslation();
  const places = stockPlaces(stock);
  if (places.length === 0) return null;
  if (places.length === 1)
    return (
      <span className="flex min-w-0 text-[13px]">
        <PlaceCell place={places[0]!.place} />
      </span>
    );
  return <StockPopup label={t('parts.multiplePlaces', { count: places.length })} stock={stock} />;
}

/** How much of an item there is: the amount, or for several "Multiple" that lists them. */
export function StockAmounts({ stock }: { stock: PartSummary['stock'] }) {
  if (stock.length === 1) return <AmountPill display={stock[0]!.display} />;
  return <StockPopup label={<MultipleAmounts stock={stock} />} stock={stock} alignRight />;
}

/** "Multiple (n)", coloured by the worst amount so low or empty stock still shows in the list. */
export function MultipleAmounts({ stock }: { stock: PartSummary['stock'] }) {
  const { t } = useTranslation();
  return (
    <AmountsPill displays={stock.map((s) => s.display)}>
      {t('parts.multipleAmounts', { count: stock.length })}
    </AmountsPill>
  );
}
