import { isValidCode, normalizeCode, type PlaceOption } from '@ixfwms/domain';
import { ChevronRight, X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlaces } from '../api/queries';
import { matchPlaces, placeLabel } from '../lib/places';
import { PlaceTag } from './ui';

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

const parentCode = (p: PlaceOption) => p.pathCodes[p.pathCodes.length - 2] ?? null;

/**
 * Place field that suggests places by name as you type ("cab a › shelf 3" works too).
 * Tab (or → at the end of the text) steps into the highlighted place, so the next words search
 * only inside it; Backspace in an empty field steps back out. A known code typed directly works too.
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
  const [scope, setScope] = useState<PlaceOption | null>(null);

  const options = useMemo(
    () => (places.data ?? []).filter((p) => p.kind !== 'in_transit' && !(exclude?.(p) ?? false)),
    [places.data, exclude],
  );
  const childCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of options) {
      const parent = parentCode(p);
      if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [options]);
  const matches = useMemo(() => {
    // Inside a scope: only places below it, direct children first.
    const pool = scope
      ? options
          .filter((p) => p.code !== scope.code && p.pathCodes.includes(scope.code))
          .sort(
            (a, b) => a.path.length - b.path.length || placeLabel(a).localeCompare(placeLabel(b)),
          )
      : options;
    return matchPlaces(pool, text);
  }, [options, text, scope]);
  const selected = options.find((p) => p.code === value) ?? null;

  const reset = () => {
    setText('');
    setScope(null);
    setActive(0);
    setOpen(false);
  };
  const choose = (place: PlaceOption) => {
    onChange(place.code);
    reset();
  };
  /** Step into a place: nothing is highlighted yet, so Enter would choose the place itself. */
  const enter = (place: PlaceOption) => {
    setScope(place);
    setText('');
    setActive(-1);
    setOpen(true);
  };
  /**
   * Enter: the highlighted match, else a typed code, else the place you stepped into.
   * Leaving the field only takes something if you typed or stepped in, never by accident.
   */
  const commit = (explicit: boolean) => {
    if (!explicit && !text && !scope) return setOpen(false);
    const match = open ? matches[active] : undefined;
    if (match) return choose(match);
    const code = normalizeCode(text);
    if (text && isValidCode(code)) {
      onChange(code);
      return reset();
    }
    if (scope) return choose(scope);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const highlighted = open ? matches[active] : undefined;
    const atEnd = e.currentTarget.selectionStart === text.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, scope ? -1 : 0));
    } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && atEnd)) {
      if (highlighted && (childCount.get(highlighted.code) ?? 0) > 0) {
        e.preventDefault();
        enter(highlighted);
      } else if (highlighted && e.key === 'Tab') {
        choose(highlighted); // nothing inside: take it and move on to the next field
      }
    } else if (e.key === 'Backspace' && text === '' && scope) {
      e.preventDefault();
      const up = parentCode(scope);
      setScope(up ? (options.find((p) => p.code === up) ?? null) : null);
      setActive(up ? -1 : 0);
    } else if (e.key === 'Enter' && (open || text)) {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      reset();
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
          <PlaceTag place={selected} />
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
      <div className="flex min-w-0 items-center gap-1 rounded-lg border border-line bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-link">
        {scope && (
          <button
            type="button"
            className="flex max-w-[60%] shrink-0 items-center gap-1 truncate text-[14px] text-muted"
            title={t('picker.stepOut')}
            onMouseDown={(e) => {
              e.preventDefault();
              setScope(null);
            }}
          >
            <span className="truncate">{placeLabel(scope)}</span>
            <span aria-hidden>›</span>
          </button>
        )}
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
          placeholder={
            scope
              ? t('picker.insidePlaceholder', { name: scope.name })
              : (placeholder ?? t('picker.placeholder'))
          }
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => commit(false), 120)}
          onKeyDown={onKey}
          className="w-full min-w-0 bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-muted"
        />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">
                {places.isPending ? t('common.loading') : t('picker.noMatch')}
              </li>
            ) : (
              matches.map((p, i) => {
                const children = childCount.get(p.code) ?? 0;
                const shownPath = scope ? p.path.slice(scope.path.length, -1) : p.path.slice(0, -1);
                return (
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
                      {shownPath.length > 0 && (
                        <span className="block truncate text-[12px] text-muted">
                          {shownPath.join(' › ')}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <PlaceTag place={p} />
                      {children > 0 && (
                        <button
                          type="button"
                          aria-label={t('picker.stepInto', { name: p.name })}
                          className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            enter(p);
                          }}
                        >
                          <ChevronRight className="size-4" aria-hidden />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
          <p className="border-t border-line bg-surface-2 px-3 py-1 text-[11.5px] text-muted">
            {scope ? t('picker.hintInside') : t('picker.hint')}
          </p>
        </div>
      )}
    </div>
  );
}
