import { type BomCheck } from '@ixfwms/domain';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  PageHeader,
  Select,
  TextArea,
  TextInput,
} from '../components/ui';
import { guessBomColumns, toBomLines, type BomColumns } from '../lib/bom-map';
import { MakeBuild } from './bom/make-build';
import { ResultTable } from './bom/result-table';
import { TagParts } from './bom/tag-parts';
import { parseDelimited, readTable, type Table } from '../lib/table';

/** "Can we build this?" for a parts list pasted from a spreadsheet or exported from CAD/EPLAN/TIA Portal. */
/** A Solid Edge style parts list (Item Number, Document Number, Title, Quantity). */
const EXAMPLE = '/samples/ixfwms-parts-list-example.csv';

export function BomPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [columns, setColumns] = useState<BomColumns>({});
  const [sets, setSets] = useState('1');
  const [result, setResult] = useState<BomCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const headers = useMemo(() => (table?.[0] ?? []).filter((h) => h.trim()), [table]);
  const load = (data: Table) => {
    setTable(data);
    setColumns(guessBomColumns(data[0] ?? []));
    setResult(null);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      load(await readTable(file));
    } catch (err) {
      setError(err);
    }
  };

  const check = async () => {
    if (!table) return;
    setBusy(true);
    setError(null);
    try {
      const lines = toBomLines(table, 1, columns, Math.max(1, Number(sets) || 1));
      setResult(await api<BomCheck>('/api/bom/check', { body: { lines } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={t('bom.title')} />
      <p className="max-w-prose text-sm text-muted">{t('bom.intro')}</p>
      <Card>
        <Field label={t('bom.paste')} hint={t('bom.pasteHint')}>
          {(id) => (
            <TextArea
              id={id}
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              className="font-mono text-[13px]"
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => load(parseDelimited(pasted))} disabled={!pasted.trim()}>
            {t('bom.usePasted')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {t('bom.chooseFile')}
          </Button>
          <Button
            onClick={() =>
              void fetch(EXAMPLE)
                .then((r) => r.text())
                .then((text) => {
                  setPasted(text);
                  load(parseDelimited(text));
                })
                .catch(setError)
            }
          >
            {t('bom.tryExample')}
          </Button>
          <a href={EXAMPLE} download className="self-center text-[13px] text-link hover:underline">
            {t('bom.template')}
          </a>
        </div>
      </Card>

      {table && (
        <Card title={t('bom.columns')}>
          <div className="grid gap-3 sm:grid-cols-5">
            {(['ref', 'name', 'quantity', 'size'] as const).map((field) => (
              <Field key={field} label={t(`bom.fields.${field}`)}>
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
            <Field label={t('bom.sets')}>
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  value={sets}
                  onChange={(e) => setSets(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button
            variant="primary"
            busy={busy}
            disabled={!columns.ref && !columns.name}
            onClick={() => void check()}
            className="self-start"
          >
            {t('bom.check', { count: Math.max(0, table.length - 1) })}
          </Button>
        </Card>
      )}
      <ErrorBox error={error} />

      {result && (
        <Card title={t('bom.result')}>
          <p className="text-lg font-semibold">
            {result.buildable === null
              ? t('bom.buildableUnknown')
              : result.buildable === 0
                ? t('bom.buildableNone', { missing: result.missing, short: result.short })
                : t('bom.buildable', { count: result.buildable })}
          </p>
          <ResultTable result={result} />
          {can('inventory') && result.lines.some((l) => l.part) && (
            <TagParts key={JSON.stringify(result.lines.map((l) => l.line))} result={result} />
          )}
          {can('inventory') && result.lines.some((l) => l.part) && (
            <MakeBuild key={JSON.stringify(result.lines.map((l) => l.line))} result={result} />
          )}
        </Card>
      )}
    </>
  );
}
