import { isValidCode, normalizeCode, type PlaceOption } from '@ixfwms/domain';
import { X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlaces } from '../api/queries';
import { matchPlaces, placeLabel } from '../lib/places';
import { CodeLabel } from './ui';

interface Props {
  id?: string;
  /** Selected place code, or '' for none. */
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  /** Hide places that can't be chosen, e.g. a place and its own sub-places when moving it. */
  exclude?: (place: PlaceOption) => boolean;
  autoFocus?: boolean;
  /** Accessible name when there is no visible label. */
  label?: string;
}

/**
 * Place field that suggests places by name as you type, following the hierarchy
 * ("cab a › shelf 3"). A known code typed directly works too.
 */
export function PlacePicker({
  id,
  value,
  onChange,
  placeholder,
  exclude,
  autoFocus,
  label,
}: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const places = usePlaces();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(
    () => (places.data ?? []).filter((p) => p.kind !== 'in_transit' && !(exclude?.(p) ?? false)),
    [places.data, exclude],
  );
  const matches = useMemo(() => matchPlaces(options, text), [options, text]);
  const selected = options.find((p) => p.code === value) ?? null;

  const choose = (place: PlaceOption) => {
    onChange(place.code);
    setText('');
    setOpen(false);
  };
  /** On Enter or leaving the field: take the highlighted match, or a typed code as is. */
  const commit = () => {
    const match = open ? matches[active] : undefined;
    if (match) return choose(match);
    const code = normalizeCode(text);
    if (text && isValidCode(code)) {
      onChange(code);
      setText('');
    }
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && (open || text)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (selected && !open && !text) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <button
          type="button"
          id={id}
          className="min-w-0 truncate text-left text-[15px]"
          onClick={() => setOpen(true)}
        >
          {placeLabel(selected)}
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <CodeLabel code={selected.code} />
          <button
            type="button"
            aria-label={t('picker.clear')}
            className="text-muted"
            onClick={() => onChange('')}
          >
            <X className="size-4" aria-hidden />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus || (open && !!selected)}
        value={text || (!open && value && !selected ? value : text)}
        placeholder={placeholder ?? t('picker.placeholder')}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(commit, 120)}
        onKeyDown={onKey}
        className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">
              {places.isPending ? t('common.loading') : t('picker.noMatch')}
            </li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-link-soft' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  {p.path.length > 1 && (
                    <span className="block truncate text-[12px] text-muted">
                      {p.path.slice(0, -1).join(' › ')}
                    </span>
                  )}
                </span>
                <CodeLabel code={p.code} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
