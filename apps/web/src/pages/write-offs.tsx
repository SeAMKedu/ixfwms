import type { WriteOffRow } from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useWriteOffs } from '../api/write-offs';
import { useSession } from '../auth/session';
import { Button, CodeLabel, Empty, ErrorBox, Loading, PageHeader, Select } from '../components/ui';
import { UnitStatusPill } from '../components/units';
import { formatDay, formatEuros } from '../lib/format';

/** One field for a spreadsheet; a leading =, +, - or @ would otherwise run as a formula. */
const csvField = (value: string) => {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** Semicolons and a byte order mark: what Excel opens directly with Finnish settings. */
function downloadCsv(header: string[], rows: string[][]) {
  const text = [header, ...rows].map((r) => r.map(csvField).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}\r\n`], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'depreciation-list.csv';
  link.click();
  URL.revokeObjectURL(url);
}

const hasDetails = ({ purchase: p }: WriteOffRow) =>
  !!p.date || p.valueCents != null || !!p.costCenter || p.usefulLifeYears != null;

/** Finance's list, for depreciation: everything with purchase details, or what has been removed. */
export function WriteOffsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const list = useWriteOffs();
  const [all, setAll] = useState(true);
  const [center, setCenter] = useState('');

  const rows = list.data ?? [];
  const centers = [...new Set(rows.flatMap((r) => r.purchase.costCenter ?? []))].sort();
  const shown = rows.filter(
    (r) =>
      (all ? hasDetails(r) : r.status === 'archived' || r.status === 'lost') &&
      (!center || r.purchase.costCenter === center),
  );
  const total = shown.reduce((sum, r) => sum + (r.purchase.valueCents ?? 0), 0);
  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2 }).format(cents / 100);
  const line = (r: WriteOffRow) => [
    r.name,
    r.code,
    r.serialNo ?? '',
    t(`unitStatus.${r.status}`),
    r.purchase.costCenter ?? '',
    r.purchase.date ?? '',
    r.purchase.valueCents != null ? money(r.purchase.valueCents) : '',
    r.purchase.usefulLifeYears?.toString() ?? '',
    r.removedAt?.slice(0, 10) ?? '',
  ];
  const header = [
    t('finance.item'),
    t('finance.code'),
    t('finance.serial'),
    t('finance.status'),
    t('finance.costCenter'),
    t('finance.date'),
    t('finance.value'),
    t('finance.usefulLife'),
    t('finance.removedAt'),
  ];

  return (
    <>
      <PageHeader title={t('finance.title')} meta={t('finance.meta')} />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('finance.title')}
          value={all ? 'all' : 'removed'}
          onChange={(e) => setAll(e.target.value === 'all')}
          className="!w-auto !py-1 text-[13px]"
        >
          <option value="all">{t('finance.all')}</option>
          <option value="removed">{t('finance.removedOnly')}</option>
        </Select>
        <Select
          aria-label={t('finance.costCenter')}
          value={center}
          onChange={(e) => setCenter(e.target.value)}
          className="!w-auto !py-1 text-[13px]"
        >
          <option value="">{t('finance.anyCenter')}</option>
          {centers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Button small disabled={!shown.length} onClick={() => downloadCsv(header, shown.map(line))}>
          {t('finance.csv')}
        </Button>
      </div>
      <ErrorBox error={list.error} />
      {!can('inventory') ? null : list.isPending ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>{t('finance.empty')}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                {header.map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i === 6 ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link to={`/u/${r.code}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <CodeLabel code={r.code} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.serialNo}</td>
                  <td className="px-3 py-2">
                    <UnitStatusPill status={r.status} always />
                  </td>
                  <td className="px-3 py-2">{r.purchase.costCenter}</td>
                  <td className="px-3 py-2 tabular">
                    {r.purchase.date && formatDay(r.purchase.date)}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {r.purchase.valueCents != null && formatEuros(r.purchase.valueCents)}
                  </td>
                  <td className="px-3 py-2 tabular">{r.purchase.usefulLifeYears}</td>
                  <td className="px-3 py-2 tabular">{r.removedAt && formatDay(r.removedAt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-medium">
                <td colSpan={6} className="px-3 py-2">
                  {t('finance.total')}
                </td>
                <td className="px-3 py-2 text-right tabular">{formatEuros(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
