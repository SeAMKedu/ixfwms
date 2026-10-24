import type { LocationSummary, PartStatus } from '@ixfwms/domain';
import { Loader2 } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, type LinkProps } from 'react-router';
import { ApiError } from '../api/client';
import { useStockLevels } from '../lib/levels';
import { placeTag } from '../lib/places';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-link text-surface border-link hover:opacity-90',
  secondary: 'bg-surface text-ink border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-link border-transparent hover:bg-link-soft',
  dark: 'bg-ink text-bg border-ink hover:opacity-90',
};
const buttonClass = (variant: Variant, small?: boolean) =>
  cx(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none',
    small ? 'px-2.5 py-1 text-[13px]' : 'px-3.5 py-2 text-sm',
    VARIANTS[variant],
  );

export function Button({
  variant = 'secondary',
  small,
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(buttonClass(variant, small), className)}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  small,
  className,
  ...props
}: LinkProps & { variant?: Variant; small?: boolean }) {
  return <Link {...props} className={cx(buttonClass(variant, small), className)} />;
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border border-line bg-surface p-4 flex flex-col gap-3 min-w-0',
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2">
          {title && (
            <h2 className="font-mono text-[11px] tracking-[0.08em] uppercase text-muted font-normal">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  eyebrow,
  meta,
  actions,
  qr,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A code whose QR is shown on wide screens, to open the same page on a phone. */
  qr?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        {eyebrow && <div className="text-sm text-muted min-w-0">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
        {meta && <div className="flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
      </div>
      {(actions || qr) && (
        <div className="flex flex-wrap items-end gap-3">
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          {qr && <PageQr code={qr} />}
        </div>
      )}
    </header>
  );
}

/** The page's QR code (desktop only): scan it to open the same thing on a phone. */
function PageQr({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <img
      src={`/api/labels/${encodeURIComponent(code)}/qr.svg`}
      alt={t('common.qrForPhone')}
      title={t('common.qrForPhone')}
      className="hidden size-20 rounded border border-line bg-white p-0.5 md:block"
    />
  );
}

type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'muted';
const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  info: 'bg-link-soft text-link',
  muted: 'bg-surface-2 text-muted',
};

export function Pill({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'tabular rounded px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: PartStatus }) {
  const { t } = useTranslation();
  if (status === 'active') return null;
  return <Pill tone={status === 'draft' ? 'info' : 'muted'}>{t(`status.${status}`)}</Pill>;
}

/** Stock amount with a colour hint: empty/zero is red, low is amber. Levels show the lab's names. */
export function AmountPill({ display }: { display: string }) {
  const { find, label } = useStockLevels();
  const level = find(display);
  const tone: Tone = level
    ? { ok: 'ok' as const, low: 'warn' as const, empty: 'crit' as const }[level.state]
    : /^0(\s|$)/.test(display)
      ? 'crit'
      : 'ok';
  return <Pill tone={tone}>{level ? label(display) : display}</Pill>;
}

/** A location or part code drawn like the white P-touch label it is printed on. */
export function CodeLabel({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[2px] border border-tape-edge bg-tape px-1.5 font-mono text-[12px] font-semibold tracking-wide text-tape-ink whitespace-nowrap',
        className,
      )}
    >
      {code}
    </span>
  );
}

/**
 * A place as a tape chip: a fixed place's address ("Robolab-A-C"), a container's short name or
 * code. The code is in the tooltip.
 */
export function PlaceTag({
  place,
  className,
}: {
  place: Pick<LocationSummary, 'movable' | 'address' | 'shortName' | 'code'> &
    Partial<Pick<LocationSummary, 'overdue'>>;
  className?: string;
}) {
  return (
    <span title={place.code} className="inline-flex">
      <CodeLabel
        code={placeTag(place)}
        className={cx(place.overdue && 'border-warn bg-warn-soft text-warn', className)}
      />
    </span>
  );
}

export function LocationPath({
  path,
  linkLast = true,
}: {
  path: LocationSummary[];
  linkLast?: boolean;
}) {
  // On a phone, long paths keep the top and the last two levels: "Robotics lab › … › Shelf 3 › Box".
  const collapse = path.length > 3;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-muted min-w-0">
      {path.map((p, i) => {
        const last = i === path.length - 1;
        const middle = collapse && i > 0 && i < path.length - 2;
        return (
          <span
            key={p.id}
            className={cx('items-center gap-1', middle ? 'hidden sm:inline-flex' : 'inline-flex')}
          >
            {last && linkLast ? (
              <Link to={`/l/${p.code}`} className="inline-flex items-center gap-1 hover:underline">
                <span className="text-ink">{p.name}</span>
                <PlaceTag place={p} />
              </Link>
            ) : (
              <Link to={`/l/${p.code}`} className="text-ink hover:underline">
                {p.name}
              </Link>
            )}
            {!last && <span aria-hidden>›</span>}
            {collapse && i === 0 && (
              <span aria-hidden className="inline-flex gap-1 sm:hidden">
                <span>…</span>
                <span>›</span>
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** "Pneumatics/Vacuum/Suction cups" as links: each level opens the parts list for that category and below. */
export function CategoryPath({ path }: { path: string }) {
  const levels = path.split('/');
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-sm">
      {levels.map((name, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <Link
            to={`/?category=${encodeURIComponent(levels.slice(0, i + 1).join('/'))}`}
            className="text-muted hover:text-link hover:underline"
          >
            {name}
          </Link>
          {i < levels.length - 1 && (
            <span aria-hidden className="text-muted">
              ›
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

const inputClass =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted';

export function TextInput(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, 'pr-8', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-8 text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t('common.loading')}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  // Errors from the server carry a key, so they show in the user's language.
  const message =
    error instanceof ApiError && error.key
      ? t(`apiErrors.${error.key}`, { ...error.params, defaultValue: error.message })
      : error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
  return (
    <div
      role="alert"
      className="rounded-lg border border-crit/30 bg-crit-soft px-3 py-2 text-sm text-crit"
    >
      {t('errors.generic', { message })}
    </div>
  );
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2 py-1 text-[13px]',
            value === o.value ? 'bg-surface font-semibold shadow-sm' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
