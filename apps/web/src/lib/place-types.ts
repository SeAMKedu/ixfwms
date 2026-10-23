import { DEFAULT_LOCATION_TYPES } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useLocationTypes } from '../api/queries';

/**
 * Display names for place types. The built-in names are translated; a type renamed or added in
 * the app shows the name it was given.
 */
export function useTypeName(): (key: string) => string {
  const { t } = useTranslation();
  const types = useLocationTypes();
  return (key) => {
    const name = types.data?.find((ty) => ty.key === key)?.name;
    const builtIn = DEFAULT_LOCATION_TYPES.find((d) => d.key === key);
    if (builtIn && (name === undefined || name === builtIn.name))
      return t(`places.types.${key}`, { defaultValue: builtIn.name });
    return name ?? key;
  };
}
