import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/*
 * Keyboard shortcuts: single keys ("e", "/", "?") and two-key sequences ("g p"). They never fire
 * while typing in a field (Escape leaves the field instead), or with Ctrl/Cmd/Alt held, so browser
 * and OS shortcuts keep working. Components register what they handle; "?" lists what's active.
 */

export interface Shortcut {
  keys: string;
  description: string;
  run: () => void;
}

interface Registry {
  register: (id: string, shortcut: Shortcut) => () => void;
  active: () => Shortcut[];
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

const ShortcutContext = createContext<Registry | null>(null);
const SEQUENCE_TIMEOUT_MS = 1200;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type)
  );
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const shortcuts = useRef(new Map<string, Shortcut>());
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let pending: string | null = null;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const sequence = pending ? `${pending} ${key}` : key;
      const all = [...shortcuts.current.values()];
      // The most recently registered wins, so a page's "e" beats a global one.
      const match = all.reverse().find((s) => s.keys === sequence);
      window.clearTimeout(timer);
      if (match) {
        e.preventDefault();
        pending = null;
        match.run();
        return;
      }
      if (!pending && all.some((s) => s.keys.startsWith(`${key} `))) {
        pending = key;
        timer = window.setTimeout(() => (pending = null), SEQUENCE_TIMEOUT_MS);
        return;
      }
      pending = null;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, []);

  const register = useCallback((id: string, shortcut: Shortcut) => {
    shortcuts.current.set(id, shortcut);
    return () => void shortcuts.current.delete(id);
  }, []);
  const active = useCallback(() => [...shortcuts.current.values()], []);
  const value = useMemo(
    () => ({ register, active, helpOpen, setHelpOpen }),
    [register, active, helpOpen],
  );
  return <ShortcutContext value={value}>{children}</ShortcutContext>;
}

export function useShortcutRegistry(): Registry {
  const registry = use(ShortcutContext);
  if (!registry) throw new Error('useShortcut outside ShortcutProvider');
  return registry;
}

/** Registers a shortcut while the component is mounted (and `enabled`). */
export function useShortcut(
  keys: string,
  description: string,
  run: () => void,
  enabled = true,
): void {
  const { register } = useShortcutRegistry();
  const id = useId();
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (!enabled) return;
    return register(id, { keys, description, run: () => latest.current() });
  }, [register, id, keys, description, enabled]);
}
