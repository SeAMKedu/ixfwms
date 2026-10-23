import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcutRegistry } from '../lib/shortcuts';

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.split(' ').map((k, i) => (
        <kbd
          key={i}
          className="min-w-6 rounded border border-line bg-surface-2 px-1.5 text-center font-mono text-[12px]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** The "?" cheat sheet: every shortcut that works on the current page. */
export function ShortcutHelp() {
  const { t } = useTranslation();
  const { helpOpen, setHelpOpen, active } = useShortcutRegistry();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (helpOpen && !d.open) d.showModal();
    if (!helpOpen && d.open) d.close();
  }, [helpOpen]);
  const list = helpOpen ? active() : [];
  const unique = [...new Map(list.map((s) => [s.keys, s])).values()].sort((a, b) =>
    a.keys.localeCompare(b.keys),
  );
  return (
    <dialog
      ref={dialog}
      onClose={() => setHelpOpen(false)}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-lg font-semibold">{t('shortcuts.title')}</h2>
        <button
          type="button"
          aria-label={t('common.cancel')}
          onClick={() => setHelpOpen(false)}
          className="text-muted"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <ul className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto px-4 py-3 text-sm">
        {unique.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-4">
            <span>{s.description}</span>
            <Keys keys={s.keys} />
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[12px] text-muted">
        {t('shortcuts.footer')}
      </p>
    </dialog>
  );
}
