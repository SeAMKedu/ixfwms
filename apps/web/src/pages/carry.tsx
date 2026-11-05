import { normalizeCode } from '@ixfwms/domain';
import { ScanLine } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCarry, useDrop } from '../api/carry';
import { useLocation } from '../api/locations';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import {
  AmountPill,
  Button,
  ButtonLink,
  Card,
  CodeLabel,
  Empty,
  ErrorBox,
  Field,
  Loading,
  LocationPath,
  PageHeader,
} from '../components/ui';
import { formatDate } from '../lib/format';

function Destination({
  code,
  count,
  onDrop,
  busy,
}: {
  code: string;
  count: number;
  onDrop: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const dest = useLocation(code, false);
  if (dest.isPending) return <Loading />;
  if (!dest.data) return <ErrorBox error={dest.error} />;
  return (
    <Card className="border-link/40">
      <LocationPath path={dest.data.path} />
      <Button
        variant="primary"
        busy={busy}
        disabled={count === 0}
        onClick={onDrop}
        className="self-start"
      >
        {t('carry.putHere', { count })}
      </Button>
    </Card>
  );
}

export function CarryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const to = params.get('to');
  const carry = useCarry(!!user);
  const drop = useDrop();
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');

  if (carry.isPending) return <Loading />;
  if (!carry.data) return <ErrorBox error={carry.error} />;
  const items = carry.data.items;
  const chosen = items.filter((i) => !unticked.has(i.id));

  const doDrop = async () => {
    if (!to) return;
    await drop.mutateAsync({ to, items: chosen.map((i) => i.id) });
    setUnticked(new Set());
    void navigate(`/l/${to}`);
  };
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setDest = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) setParams({ to: normalizeCode(typed) });
  };

  return (
    <>
      <PageHeader
        title={t('carry.title')}
        meta={carry.data.since && t('carry.since', { date: formatDate(carry.data.since) })}
      />
      <p className="max-w-prose text-sm text-muted">{t('carry.intro')}</p>
      <Card>
        {items.length === 0 ? (
          <Empty>{t('carry.empty')}</Empty>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 border-t border-line py-2 first:border-t-0"
              >
                <input
                  type="checkbox"
                  checked={!unticked.has(item.id)}
                  onChange={() => toggle(item.id)}
                  aria-label={item.kind === 'lot' ? item.part.name : item.name}
                />
                {item.kind === 'unit' ? (
                  <Link
                    to={`/u/${item.code}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2"
                  >
                    <span className="truncate">{item.name}</span>
                    <CodeLabel code={item.code} />
                  </Link>
                ) : item.kind === 'location' ? (
                  <Link
                    to={`/l/${item.code}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2"
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="flex items-center gap-2 text-[12px] text-muted">
                      {t('carry.box')}
                      <CodeLabel code={item.code} />
                    </span>
                  </Link>
                ) : (
                  <Link
                    to={`/p/${item.part.code}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2"
                  >
                    <span className="truncate">{item.part.name}</span>
                    <AmountPill display={item.display} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {items.length > 0 &&
        (to ? (
          <Destination
            code={to}
            count={chosen.length}
            busy={drop.isPending}
            onDrop={() => void doDrop()}
          />
        ) : (
          <Card>
            <ButtonLink to="/scan?mode=drop" variant="primary" className="self-start">
              <ScanLine className="size-4" aria-hidden />
              {t('carry.scanDestination')}
            </ButtonLink>
            <form onSubmit={setDest} className="flex items-end gap-2">
              <Field label={t('carry.destination')}>
                {(id) => <PlacePicker id={id} value={typed} onChange={setTyped} />}
              </Field>
              <Button type="submit">{t('common.open')}</Button>
            </form>
          </Card>
        ))}
      <ErrorBox error={drop.error} />
    </>
  );
}
