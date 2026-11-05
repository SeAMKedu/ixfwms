import { type ImportResult } from '@ixfwms/domain';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { Button, Card, ErrorBox, PageHeader } from '../components/ui';
import { guessColumns, mapRows, type Columns } from '../lib/import-map';
import { parseDelimited, readTable, type Table } from '../lib/table';
import { ColumnsCard } from './import/columns';
import { DEFAULT_CHOICES, ImportOptionsCard, type ImportChoices } from './import/options';
import { PreviewTable } from './import/preview';

/** Spreadsheet import: pick a file, map its columns, preview, import as drafts. */
/** Example file with the column names the import recognises; also the download template. */
const EXAMPLE = '/samples/ixfwms-import-example.csv';

export function ImportPage() {
  const { t } = useTranslation();
  const { user, checking } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Columns>({});
  const [choices, setChoices] = useState<ImportChoices>(DEFAULT_CHOICES);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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

  const load = async (name: string, read: () => Promise<Table>) => {
    setError(null);
    setResults(null);
    setImported(false);
    try {
      const data = await read();
      setTable(data);
      setFileName(name);
      setHeaderRow(1);
      setColumns(guessColumns(data[0] ?? []));
    } catch (err) {
      setError(err);
    }
  };
  const onFile = async (file: File | undefined) => {
    if (file) await load(file.name, () => readTable(file));
  };
  const tryExample = () =>
    load(EXAMPLE.split('/').pop()!, async () =>
      parseDelimited(await (await fetch(EXAMPLE)).text()),
    );

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportResult[]>('/api/import/parts', {
        body: {
          rows: good.map((m) => m.row),
          options: {
            matchExisting: choices.matchExisting,
            blankQuantity: choices.blankQuantity,
            defaultLocation: choices.defaultLocation || null,
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
          <Button onClick={() => void tryExample()}>{t('import.tryExample')}</Button>
          <a href={EXAMPLE} download className="text-[13px] text-link hover:underline">
            {t('import.template')}
          </a>
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
          <ColumnsCard
            headers={headers}
            headerRow={headerRow}
            setHeaderRow={setHeaderRow}
            columns={columns}
            setColumns={setColumns}
          />

          <ImportOptionsCard value={choices} onChange={setChoices} />

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
