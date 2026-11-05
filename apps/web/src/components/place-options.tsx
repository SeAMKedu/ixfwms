import type { PlaceOption } from '@ixfwms/domain';
import { ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { placeLabel } from '../lib/places';
import { PlaceTag } from './ui';

/* Pieces of PlacePicker. */

/** The chosen place, shown in place of the text field until you click it. */
export function SelectedPlace({
  id,
  place,
  onOpen,
  onClear,
}: {
  id?: string;
  place: PlaceOption;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <button
        type="button"
        id={id}
        className="min-w-0 truncate text-left text-[15px]"
        onClick={onOpen}
      >
        {placeLabel(place)}
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        <PlaceTag place={place} />
        <button
          type="button"
          aria-label={t('picker.clear')}
          className="text-muted"
          onClick={onClear}
        >
          <X className="size-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}

/** One suggestion: its name, the path to it (from the place stepped into), and a way in. */
export function PlaceOptionRow({
  place,
  scope,
  active,
  inside,
  onChoose,
  onHover,
  onEnter,
}: {
  place: PlaceOption;
  scope: PlaceOption | null;
  active: boolean;
  /** How many places are inside it. */
  inside: number;
  onChoose: () => void;
  onHover: () => void;
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  const shownPath = scope ? place.path.slice(scope.path.length, -1) : place.path.slice(0, -1);
  return (
    <li
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onChoose();
      }}
      onMouseEnter={onHover}
      className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${active ? 'bg-link-soft' : ''}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{place.name}</span>
        {shownPath.length > 0 && (
          <span className="block truncate text-[12px] text-muted">{shownPath.join(' › ')}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <PlaceTag place={place} />
        {inside > 0 && (
          <button
            type="button"
            aria-label={t('picker.stepInto', { name: place.name })}
            className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEnter();
            }}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}
