import { IMPORT_FIELDS, type ImportMapping, type ImportResult } from '@ixfwms/domain';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  PageHeader,
  Pill,
  Select,
  TextInput,
} from '../components/ui';
import { guessColumns, mapRows, type Columns } from '../lib/import-map';
import { readTable, type Table } from '../lib/table';

const ACTION_TONE = { create: 'info', add_stock: 'ok', skip: 'muted', error: 'crit' } as const;

/** Spreadsheet import: pick a file, map its columns, preview, import as drafts. */
export function ImportPage() {
  const { t } = useTranslation();
  const { user, checking } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Columns>({});
  const [defaultLocation, setDefaultLocation] = useState('');
  const [matchExisting, setMatchExisting] = useState(true);
  const [mappingName, setMappingName] = useState('');
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mappings = useQuery({
    queryKey: ['importMappings'],
    queryFn: () => api<{ name: string; mapping: ImportMapping }[]>('/api/import/mappings'),
    enabled: !!user,
  });

  const headers = useMemo(
    () => (table?.[headerRow - 1] ?? []).filter((h) => h.trim() !== ''),
    [table, headerRow],
  );
  const mapped = useMemo(
    () => (table ? mapRows(table, headerRow, columns) : []),
    [table, headerRow, columns],
  );
  const good = mapped.filter((m) => m.row);

  if (!checking && !user) return <Navigate to="/login?next=/import" replace />;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResults(null);
    setImported(false);
    try {
      const data = await readTable(file);
      setTable(data);
      setFileName(file.name);
      setHeaderRow(1);
      setColumns(guessColumns(data[0] ?? []));
    } catch (err) {
      setError(err);
    }
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResult[]>('/api/import/parts', {
        body: {
          rows: good.map((m) => m.row),
          options: {
            matchExisting,
            defaultLocation: defaultLocation || null,
            source: `import: ${fileName}`,
          },
          dryRun,
        },
      });
      setResults(res);
      setImported(!dryRun);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async () => {
    if (!mappingName.trim()) return;
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
    setColumns(m.mapping.columns);
    setMappingName(name);
  };

  return (
    <>
      <PageHeader title={t('import.title')} />
      <p className="max-w-prose text-sm text-muted">{t('import.intro')}</p>
      <Card>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="sr-only"
          id="import-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {t('import.chooseFile')}
          </Button>
          {table && (
            <span className="text-sm text-muted">
              {t('import.fileInfo', {
                name: fileName,
                count: Math.max(0, table.length - headerRow),
              })}
            </span>
          )}
        </div>
      </Card>
      <ErrorBox error={error} />

      {table && (
        <>
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
          </Card>

          <Card title={t('import.options')}>
            <Field label={t('import.defaultLocation')} hint={t('import.defaultLocationHint')}>
              {(id) => (
                <PlacePicker id={id} value={defaultLocation} onChange={setDefaultLocation} />
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={matchExisting}
                onChange={(e) => setMatchExisting(e.target.checked)}
              />
              {t('import.matchExisting')}
            </label>
          </Card>

          <Card title={t('import.preview')}>
            <PreviewTable table={table} mapped={mapped} results={results} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void run(true)}
                busy={busy && !imported}
                disabled={!columns.name || good.length === 0}
              >
                {t('import.check')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void run(false)}
                busy={busy}
                disabled={!results || imported || good.length === 0}
              >
                {t('import.run', {
                  count: results
                    ? results.filter((r) => r.action !== 'error' && r.action !== 'skip').length
                    : good.length,
                })}
              </Button>
              {imported && (
                <Link to="/inbox" className="text-sm text-link">
                  {t('import.done')}
                </Link>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function PreviewTable({
  table,
  mapped,
  results,
}: {
  table: Table;
  mapped: ReturnType<typeof mapRows>;
  results: ImportResult[] | null;
}) {
  const { t } = useTranslation();
  // Results come back for the readable rows only, in order.
  const resultByLine = new Map<number, ImportResult>();
  let i = 0;
  for (const m of mapped) if (m.row && results?.[i]) resultByLine.set(m.line, results[i++]!);
  const summary = results ? countBy(results.map((r) => r.action)) : null;
  return (
    <>
      {summary && (
        <div className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(ACTION_TONE) as ImportResult['action'][]).map((a) =>
            summary[a] ? (
              <Pill key={a} tone={ACTION_TONE[a]}>
                {t(`import.actions.${a}`, { count: summary[a] })}
              </Pill>
            ) : null,
          )}
        </div>
      )}
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">{t('import.fields.name')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.fields.orderNo')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.fields.quantity')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.fields.location')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.result')}</th>
            </tr>
          </thead>
          <tbody>
            {mapped.slice(0, 500).map((m) => {
              const r = resultByLine.get(m.line);
              return (
                <tr key={m.line} className="border-t border-line align-top">
                  <td className="px-2 py-1 tabular text-muted">{m.line}</td>
                  <td className="px-2 py-1">{m.row?.name ?? table[m.line - 1]?.join(' · ')}</td>
                  <td className="px-2 py-1 font-mono">{m.row?.orderNo}</td>
                  <td className="px-2 py-1 tabular">
                    {m.row?.level ??
                      (m.row?.quantity != null ? `${m.row.quantity} ${m.row.unit ?? ''}` : '')}
                  </td>
                  <td className="px-2 py-1">{r?.location?.name ?? m.row?.location}</td>
                  <td className="px-2 py-1">
                    {m.problem ? (
                      <Pill tone="crit">{m.problem}</Pill>
                    ) : r ? (
                      <span className="flex flex-col gap-0.5">
                        <Pill tone={ACTION_TONE[r.action]}>
                          {t(`import.actions.${r.action}`, { count: 1 })}
                        </Pill>
                        {r.part && (
                          <Link to={`/p/${r.part.code}`} className="text-link">
                            {r.part.name}
                          </Link>
                        )}
                        {r.message && <span className="text-muted">{r.message}</span>}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
