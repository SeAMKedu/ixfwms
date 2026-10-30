import { fold } from '@ixfwms/domain';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePeople } from '../api/loans';

interface Props {
  id?: string;
  /** The name as typed or chosen; the server checks it belongs to someone. */
  value: string;
  onChange: (name: string) => void;
}

/** Name field that suggests people with an account as you type, anywhere in the name. */
export function PersonPicker({ id, value, onChange }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const people = usePeople();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const text = fold(value.trim());
    return (people.data ?? []).filter((name) => fold(name).includes(text));
  }, [people.data, value]);

  const choose = (name: string) => {
    onChange(name);
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
      choose(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={t('person.placeholder')}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t('person.noMatch')}</li>
          ) : (
            matches.map((name, i) => (
              <li
                key={name}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(name);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? 'bg-link-soft' : ''}`}
              >
                {name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
