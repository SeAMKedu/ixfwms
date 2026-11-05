import { LEVEL_STATES, levelKey, type LevelState, type StockLevelDef } from '@ixfwms/domain';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLabSettings, useUpdateSettings } from '../../api/system';
import { useSession } from '../../auth/session';
import {
  Button,
  Card,
  ErrorBox,
  Loading,
  PageHeader,
  Select,
  TextInput,
} from '../../components/ui';
import { useStockLevels } from '../../lib/levels';

/** The levels offered for stock tracked as a level: names, order (best first) and meaning. */
export function LevelsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  const { label } = useStockLevels();
  const [draft, setDraft] = useState<StockLevelDef[] | null>(null);
  const saved = settings.data?.stockLevels;
  // Built-in levels show their translated name until someone renames them.
  const levels = draft ?? saved?.map((l) => ({ ...l, name: label(l.key) }));
  const canEdit = can('write');
  const set = (next: StockLevelDef[]) => setDraft(next);
  const change = (i: number, patch: Partial<StockLevelDef>) =>
    levels && set(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const swap = (i: number, j: number) => {
    if (!levels) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };
  const add = () =>
    levels &&
    set([
      ...levels,
      {
        key: levelKey(
          t('settings.newLevel'),
          levels.map((l) => l.key),
        ),
        name: '',
        state: 'low',
      },
    ]);
  const save = async () => {
    if (!levels) return;
    // Names typed for new levels give them their keys; existing keys never change.
    const keys = new Set(saved?.map((l) => l.key));
    const out: StockLevelDef[] = [];
    for (const l of levels) {
      const name = l.name.trim();
      const key = keys.has(l.key) ? l.key : levelKey(name, out.map((o) => o.key).concat([...keys]));
      // An unchanged translated name is stored as the original (English) one, so it stays translated.
      const builtIn = saved?.find((s) => s.key === key);
      out.push({
        key,
        name: builtIn && name === label(key) ? builtIn.name : name,
        state: l.state,
      });
    }
    await update.mutateAsync({ stockLevels: out });
    setDraft(null);
  };
  return (
    <>
      <PageHeader title={t('settings.levels')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.levelsIntro')}</p>
        {!levels ? (
          <Loading />
        ) : (
          <ul className="flex flex-col">
            {levels.map((l, i) => (
              <li
                key={l.key}
                className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0"
              >
                <TextInput
                  aria-label={t('settings.levelName')}
                  value={l.name}
                  disabled={!canEdit}
                  placeholder={t('settings.newLevel')}
                  className="max-w-56"
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <Select
                  aria-label={t('settings.levelState')}
                  value={l.state}
                  disabled={!canEdit}
                  className="!w-auto"
                  onChange={(e) => change(i, { state: e.target.value as LevelState })}
                >
                  {LEVEL_STATES.map((s) => (
                    <option key={s} value={s}>
                      {t(`settings.levelStates.${s}`)}
                    </option>
                  ))}
                </Select>
                {canEdit && (
                  <span className="flex items-center">
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('settings.moveUp')}
                      disabled={i === 0}
                      onClick={() => swap(i, i - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('settings.moveDown')}
                      disabled={i === levels.length - 1}
                      onClick={() => swap(i, i + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('common.remove')}
                      disabled={levels.length <= 2}
                      onClick={() => set(levels.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && levels && (
          <div className="flex flex-wrap gap-2">
            <Button small onClick={add} disabled={levels.length >= 8}>
              <Plus className="size-4" aria-hidden />
              {t('settings.addLevel')}
            </Button>
            {draft && (
              <>
                <Button
                  small
                  variant="primary"
                  busy={update.isPending}
                  disabled={draft.some((l) => !l.name.trim())}
                  onClick={() => void save()}
                >
                  {t('common.save')}
                </Button>
                <Button small onClick={() => setDraft(null)}>
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </div>
        )}
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}
