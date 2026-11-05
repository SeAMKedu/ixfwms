import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSession } from '../auth/session';
import { useShortcut, useShortcutRegistry } from '../lib/shortcuts';

/** Shortcuts that work on every page. */
export function GlobalShortcuts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can, user } = useSession();
  const { setHelpOpen } = useShortcutRegistry();
  const go = (path: string) => () => void navigate(path);
  useShortcut('?', t('shortcuts.help'), () => setHelpOpen(true));
  useShortcut('/', t('shortcuts.search'), () => {
    const input = document.querySelector<HTMLInputElement>('[data-shortcut-search]');
    if (input) input.focus();
    else void navigate('/items?focus=1');
  });
  // Pages people without an account can't use (LOGIN_ONLY in app.tsx) have no shortcut for them.
  useShortcut('g p', t('shortcuts.goParts'), go('/items'));
  useShortcut('g i', t('shortcuts.goInbox'), go('/inbox'), !!user);
  useShortcut('g l', t('shortcuts.goPlaces'), go('/places'));
  useShortcut('g s', t('shortcuts.goScan'), go('/scan'));
  useShortcut('g c', t('shortcuts.goCarry'), go('/carry'), !!user);
  useShortcut('g h', t('shortcuts.goHistory'), go('/history'), !!user);
  useShortcut('g b', t('shortcuts.goBom'), go('/bom'));
  useShortcut('n', t('shortcuts.newPart'), go('/parts/new'), can('inventory'));
  return null;
}
