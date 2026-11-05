import { formatPiece, type BomCheck, type BomStatus } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CodeLabel, Pill } from '../../components/ui';

const STATUS_TONE: Record<BomStatus, 'ok' | 'warn' | 'crit' | 'info'> = {
  ok: 'ok',
  unknown: 'info',
  short: 'warn',
  missing: 'crit',
};

/** Each line of the parts list: what it matched, how many we have and where. */
export function ResultTable({ result }: { result: BomCheck }) {
  const { t } = useTranslation();
  return (
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
              <td className="px-2 py-1.5 text-right tabular">
                {l.quantity}
                {l.size && (
                  <span className="block whitespace-nowrap text-[12px] text-muted">
                    × {formatPiece(l.size)}
                  </span>
                )}
              </td>
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
  );
}
