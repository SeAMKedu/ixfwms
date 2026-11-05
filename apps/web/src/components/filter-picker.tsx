import { fold } from '@ixfwms/domain';
import { X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface FilterOption {
  name: string;
  /** How many items have it, shown beside the name. */
  count: number;
}

interface Props {
  id?: string;
  /** Accessible name of the field. */
  label: string;
  placeholder: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Choosing adds to the values; otherwise it replaces the one there. */
  multiple?: boolean;
}

/**
 * Filter field that suggests known names as you type, anywhere in the name. What's chosen sits in
 * the field as chips; Backspace in the empty field takes the last one off. Nothing new is created,
 * and text left unchosen is dropped on leaving the field.
 */
export function FilterPicker({
  id,
  label,
  placeholder,
  options,
  values,
  onChange,
  multiple,
}: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const wanted = fold(text.trim());
    const chosen = new Set(values.map(fold));
    return options.filter((o) => !chosen.has(fold(o.name)) && fold(o.name).includes(wanted));
  }, [options, values, text]);

  const choose = (name: string) => {
    onChange(multiple ? [...values, name] : [name]);
    setText('');
    setActive(0);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (open) setActive((a) => Math.max(0, Math.min(matches.length - 1, a + step)));
      setOpen(true);
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      choose(matches[active].name);
    } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 rounded-lg border border-line bg-surface px-2 focus-within:outline focus-within:outline-2 focus-within:outline-link">
        {values.map((value) => (
          <span
            key={value}
            className="my-1.5 flex max-w-full min-w-0 items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1.5 pl-2.5 text-[13px]"
          >
            <span className="truncate">{value}</span>
            <button
              type="button"
              aria-label={t('parts.filters.remove', { name: value })}
              className="shrink-0 text-muted"
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          placeholder={values.length ? undefined : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setText('');
          }}
          onKeyDown={onKey}
          className="w-16 min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-ink !outline-none placeholder:text-muted"
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t('parts.filters.noMatch')}</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.name}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.name);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-link-soft' : ''}`}
              >
                <span className="min-w-0 truncate">{o.name}</span>
                <span className="shrink-0 text-[12px] text-muted">{o.count}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
