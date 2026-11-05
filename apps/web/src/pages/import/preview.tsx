import type { ImportResult } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Pill } from '../../components/ui';
import type { mapRows } from '../../lib/import-map';
import type { Table } from '../../lib/table';

const ACTION_TONE = { create: 'info', add_stock: 'ok', skip: 'muted', error: 'crit' } as const;

/** The rows as they'll be imported, with what a check or the import did with each. */
export function PreviewTable({
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
