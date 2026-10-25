import type { PartSummary } from '@ixfwms/domain';
import { useEffect, useId, useState, type KeyboardEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useParts } from '../api/queries';
import { CodeLabel, TextInput } from './ui';

const MIN_CHARS = 2;

/**
 * A name field that suggests existing items as you type, like the place picker. The text stays
 * free (a new item's name); ↓/↑ move through the suggestions and Enter or a click takes one.
 * Without a highlighted suggestion Enter does what it does in the form.
 */
export function ItemSuggest({
  id,
  value,
  onChange,
  onPick,
  inputRef,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (part: PartSummary) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Ask the server a moment after typing stops.
  const [query, setQuery] = useState(value.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [value]);
  const enough = query.length >= MIN_CHARS;
  const found = useParts({ q: enough ? query : undefined, byUnit: false, limit: 6 });
  const matches = enough ? (found.data?.items ?? []) : [];
  const shown = open && enough && matches.length > 0;

  const pick = (part: PartSummary) => {
    onPick(part);
    setOpen(false);
    setActive(-1);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp' && shown) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter' && shown && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <TextInput
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        required
        autoFocus
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
      />
      {shown && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <p className="border-b border-line bg-surface-2 px-3 py-1 text-[11.5px] text-muted">
            {t('session.existing')}
          </p>
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {matches.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-link-soft' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {p.tracking === 'individual'
                      ? t('session.unitCount', { count: p.units.length })
                      : p.stock.map((s) => `${s.display} · ${s.location}`).join(', ') ||
                        t('session.noStock')}
                  </span>
                </span>
                <CodeLabel code={p.code} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
