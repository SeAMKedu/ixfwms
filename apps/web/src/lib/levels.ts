import { DEFAULT_STOCK_LEVELS, type StockLevelDef } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useLabSettings } from '../api/queries';

/**
 * The lab's stock levels, best first, with display names: the built-in ones are translated
 * while they keep their original name; a renamed or added level shows the name it was given.
 */
export function useStockLevels(): {
  levels: StockLevelDef[];
  label: (key: string) => string;
  find: (key: string) => StockLevelDef | undefined;
} {
  const { t } = useTranslation();
  const levels = useLabSettings().data?.stockLevels ?? DEFAULT_STOCK_LEVELS;
  const find = (key: string) => levels.find((l) => l.key === key);
  const label = (key: string) => {
    const level = find(key);
    const builtIn = DEFAULT_STOCK_LEVELS.find((d) => d.key === key);
    if (builtIn && (!level || level.name === builtIn.name))
      return t(`amount.${key}`, { defaultValue: builtIn.name });
    return level?.name ?? key;
  };
  return { levels, label, find };
}
