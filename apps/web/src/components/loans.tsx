import type { LendInput, LoanView } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDate, formatDay } from '../lib/format';
import { Field, TextArea, TextInput } from './ui';

/**
 * Lent out of the lab: since when, what for, who is responsible. `code` is the page's own thing;
 * when the loan is of a container it went out in, that container is linked.
 */
export function LoanNote({ loan, code }: { loan: LoanView; code: string }) {
  const { t } = useTranslation();
  const inside = loan.place && loan.place.code !== code ? loan.place : null;
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-sm ${loan.overdue ? 'bg-crit-soft text-crit' : 'bg-warn-soft text-warn'}`}
    >
      <strong>{t('units.lentOutSince', { date: formatDate(loan.outAt) })}</strong>
      {inside && (
        <span className="text-ink">
          {t('loans.inside')}{' '}
          <Link to={`/l/${inside.code}`} className="font-medium underline">
            {inside.name}
          </Link>
        </span>
      )}
      <span className="text-ink">{loan.description}</span>
      <span className="text-ink">
        {[
          loan.responsible && t('units.responsible', { name: loan.responsible }),
          loan.dueAt && t('units.dueBack', { date: formatDay(loan.dueAt) }),
          loan.overdue && t('units.overdue'),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}

export interface LendDraft {
  description: string;
  responsible: string;
  due: string;
}

export const emptyLend: LendDraft = { description: '', responsible: '', due: '' };

export const lendInput = (d: LendDraft): LendInput => ({
  responsible: d.responsible.trim() || null,
  description: d.description,
  dueAt: d.due || null,
});

/** What for, who is responsible and when it's expected back; for a unit or a whole container. */
export function LendFields({
  draft,
  onChange,
}: {
  draft: LendDraft;
  onChange: (d: LendDraft) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<LendDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <Field label={t('units.lendWhat')} hint={t('units.lendWhatHint')}>
        {(id) => (
          <TextArea
            id={id}
            required
            autoFocus
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label={t('units.responsibleField')} hint={t('units.responsibleHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={draft.responsible}
              onChange={(e) => set({ responsible: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('units.dueField')} hint={t('common.optional')}>
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={draft.due}
              onChange={(e) => set({ due: e.target.value })}
            />
          )}
        </Field>
      </div>
    </>
  );
}
