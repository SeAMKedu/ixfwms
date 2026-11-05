import { IMPORT_FIELDS, type ImportMapping } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Card, ErrorBox, Field, Select, TextInput } from '../../components/ui';
import type { Columns } from '../../lib/import-map';

/** Which column is which, from the header row on; mappings can be saved and picked again. */
export function ColumnsCard({
  headers,
  headerRow,
  setHeaderRow,
  columns,
  setColumns,
}: {
  headers: string[];
  headerRow: number;
  setHeaderRow: (row: number) => void;
  columns: Columns;
  setColumns: (update: (c: Columns) => Columns) => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [mappingName, setMappingName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const mappings = useQuery({
    queryKey: ['importMappings'],
    queryFn: () => api<{ name: string; mapping: ImportMapping }[]>('/api/import/mappings'),
    enabled: !!user,
  });

  const saveMapping = async () => {
    if (!mappingName.trim()) return;
    setError(null);
    await api('/api/import/mappings', {
      method: 'PUT',
      body: { name: mappingName.trim(), mapping: { columns, headerRow } },
    }).catch(setError);
    void mappings.refetch();
  };

  const applyMapping = (name: string) => {
    const m = mappings.data?.find((x) => x.name === name);
    if (!m) return;
    setHeaderRow(m.mapping.headerRow);
    setColumns(() => m.mapping.columns);
    setMappingName(name);
  };

  return (
    <Card title={t('import.columns')}>
      <div className="flex flex-wrap items-end gap-3">
        {(mappings.data ?? []).length > 0 && (
          <Field label={t('import.savedMapping')}>
            {(id) => (
              <Select
                id={id}
                value=""
                onChange={(e) => applyMapping(e.target.value)}
                className="!w-auto"
              >
                <option value="">{t('import.pickMapping')}</option>
                {mappings.data?.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('import.headerRow')}>
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={50}
              value={headerRow}
              onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
              className="!w-20"
            />
          )}
        </Field>
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_FIELDS.map((field) => (
          <Field key={field} label={t(`import.fields.${field}`)}>
            {(id) => (
              <Select
                id={id}
                value={columns[field] ?? ''}
                onChange={(e) =>
                  setColumns((c) => ({ ...c, [field]: e.target.value || undefined }))
                }
              >
                <option value="">{t('import.notInFile')}</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('import.mappingName')}>
          {(id) => (
            <TextInput
              id={id}
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder={t('import.mappingPlaceholder')}
            />
          )}
        </Field>
        <Button onClick={() => void saveMapping()} disabled={!mappingName.trim()}>
          {t('import.saveMapping')}
        </Button>
      </div>
      <ErrorBox error={error} />
    </Card>
  );
}
