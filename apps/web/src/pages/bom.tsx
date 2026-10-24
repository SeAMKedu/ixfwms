import type { BomCheck, BomStatus } from '@ixfwms/domain';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  CodeLabel,
  ErrorBox,
  Field,
  PageHeader,
  Pill,
  Select,
  TextArea,
  TextInput,
} from '../components/ui';
import { guessBomColumns, toBomLines, type BomColumns } from '../lib/bom-map';
import { MakeBuild } from './bom/make-build';
import { parseDelimited, readTable, type Table } from '../lib/table';

const STATUS_TONE: Record<BomStatus, 'ok' | 'warn' | 'crit' | 'info'> = {
  ok: 'ok',
  unknown: 'info',
  short: 'warn',
  missing: 'crit',
};

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
  const [tag, setTag] = useState('');
  const [tagged, setTagged] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const headers = useMemo(() => (table?.[0] ?? []).filter((h) => h.trim()), [table]);
  const load = (data: Table) => {
    setTable(data);
    setColumns(guessBomColumns(data[0] ?? []));
    setResult(null);
    setTagged(null);
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
  const tagAll = async () => {
    if (!result || !tag.trim()) return;
    const codes = [...new Set(result.lines.flatMap((l) => (l.part ? [l.part.code] : [])))];
    const res = await api<{ tagged: number }>('/api/bom/tag', {
      body: { codes, tag: tag.trim() },
    }).catch((err: unknown) => {
      setError(err);
      return null;
    });
    if (res) setTagged(res.tagged);
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
          <div className="grid gap-3 sm:grid-cols-4">
            {(['ref', 'name', 'quantity'] as const).map((field) => (
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
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">{t('bom.fields.ref')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t('bom.need')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('bom.status')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('bom.part')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t('bom.have')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('bom.where')}</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.line} className="border-t border-line align-top">
                    <td className="px-2 py-1.5">
                      <span className="font-mono">{l.ref}</span>
                      {l.name && <span className="block text-muted">{l.name}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">{l.quantity}</td>
                    <td className="px-2 py-1.5">
                      <Pill tone={STATUS_TONE[l.status]}>{t(`bom.statuses.${l.status}`)}</Pill>
                    </td>
                    <td className="px-2 py-1.5">
                      {l.part ? (
                        <span className="flex flex-col">
                          <Link to={`/p/${l.part.code}`} className="text-link hover:underline">
                            {l.part.name}
                          </Link>
                          {l.match === 'similar' && (
                            <span className="text-[12px] text-warn">{t('bom.byName')}</span>
                          )}
                        </span>
                      ) : l.candidates.length > 0 ? (
                        <span className="text-[12px] text-muted">
                          {t('bom.maybe')}{' '}
                          {l.candidates.map((c, i) => (
                            <span key={c.code}>
                              {i > 0 && ', '}
                              <Link to={`/p/${c.code}`} className="text-link">
                                {c.name}
                              </Link>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {l.part ? `${l.available}${l.uncounted ? '+' : ''}` : ''}
                      {l.salvageable > 0 && (
                        <span className="block whitespace-nowrap text-[12px] text-muted">
                          {t('builds.salvageable', { count: l.salvageable })}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex flex-col gap-0.5">
                        {l.where.map((w) => (
                          <Link
                            key={w.code + w.display}
                            to={`/l/${w.code}`}
                            className="flex items-center gap-1.5 hover:underline"
                          >
                            <CodeLabel code={w.code} />
                            <span className="text-muted">
                              {w.display}
                              {w.build && ` · ${t('builds.builtInto', { name: w.build.name })}`}
                            </span>
                          </Link>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('inventory') && result.lines.some((l) => l.part) && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('bom.tagLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder={t('bom.tagPlaceholder')}
                  />
                )}
              </Field>
              <Button onClick={() => void tagAll()} disabled={!tag.trim()}>
                {t('bom.tag')}
              </Button>
              {tagged !== null && (
                <Link to={`/?tag=${encodeURIComponent(tag.trim())}`} className="text-sm text-link">
                  {t('bom.tagged', { count: tagged })}
                </Link>
              )}
            </div>
          )}
          {can('inventory') && result.lines.some((l) => l.part) && (
            <MakeBuild key={JSON.stringify(result.lines.map((l) => l.line))} result={result} />
          )}
        </Card>
      )}
    </>
  );
}
