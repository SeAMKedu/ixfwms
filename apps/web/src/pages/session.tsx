import type { SimilarPart } from '@ixfwms/domain';
import { Camera } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useAddStock, useAttach, useCreatePart, useLocation, useUpload } from '../api/queries';
import { useSession } from '../auth/session';
import { AmountFields, toAmountInput, useAmountState } from '../components/amount-fields';
import {
  AmountPill,
  Button,
  Card,
  CodeLabel,
  ErrorBox,
  Field,
  Loading,
  LocationPath,
  PageHeader,
  TextInput,
} from '../components/ui';

interface Added {
  code: string;
  name: string;
  display: string;
}

/** Inventory session: photo, name, amount, save, next. Everything lands as a draft in this place. */
export function SessionPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { user, checking } = useSession();
  const place = useLocation(code, false);
  const [name, setName] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [amount, setAmount] = useAmountState();
  const [added, setAdded] = useState<Added[]>([]);
  const [similar, setSimilar] = useState<SimilarPart[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const create = useCreatePart();
  const addStock = useAddStock();
  const upload = useUpload();
  const attach = useAttach();

  if (!checking && !user) return <Navigate to={`/login?next=/l/${code}/add`} replace />;
  if (place.isPending) return <Loading />;
  if (!place.data) return <ErrorBox error={place.error} />;
  const here = place.data;
  const a = toAmountInput(amount);

  const reset = () => {
    setName('');
    setOrderNo('');
    setPhoto(null);
    setSimilar([]);
    setAmount((s) => ({ ...s, quantity: '' }));
    if (photoInput.current) photoInput.current.value = '';
    nameInput.current?.focus();
  };

  const checkSimilar = async () => {
    if (!name.trim() && !orderNo.trim()) return setSimilar([]);
    const found = await api<SimilarPart[]>('/api/parts/similar', {
      body: { name: name || null, identifiers: orderNo ? [orderNo] : [] },
    }).catch(() => []);
    setSimilar(found.slice(0, 3));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!a) return;
    const part = await create.mutateAsync({
      name,
      identifiers: orderNo.trim() ? [{ kind: 'order_no', value: orderNo.trim() }] : [],
      tags: [],
      attributes: {},
      status: 'draft',
      source: photo ? `inventory session, photo ${photo.name}` : 'inventory session',
      stock: { location: here.code, amount: a },
    });
    if (photo) {
      const file = await upload.mutateAsync(photo);
      await attach.mutateAsync({
        owner: 'part',
        ref: part.code,
        kind: 'photo',
        fileId: file.id,
        title: photo.name,
      });
    }
    setAdded((list) => [
      { code: part.code, name: part.name, display: part.lots[0]?.display ?? '' },
      ...list,
    ]);
    reset();
  };

  const addToExisting = async (match: SimilarPart) => {
    if (!a) return;
    const lot = await addStock.mutateAsync({ part: match.code, location: here.code, amount: a });
    setAdded((list) => [{ code: match.code, name: match.name, display: lot.display }, ...list]);
    reset();
  };

  const busy = create.isPending || upload.isPending || attach.isPending || addStock.isPending;
  return (
    <>
      <PageHeader
        title={t('session.title')}
        eyebrow={<LocationPath path={here.path} />}
        meta={added.length > 0 && t('session.added', { count: added.length })}
        actions={
          <Link to={`/l/${here.code}`} className="text-sm text-link">
            {t('session.done')}
          </Link>
        }
      />
      <p className="text-sm text-muted">{t('session.intro')}</p>
      <form onSubmit={(e) => void save(e)}>
        <Card>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            id="session-photo"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            className="grid h-28 place-items-center rounded-xl border-2 border-dashed border-line text-sm text-muted"
          >
            <span className="flex flex-col items-center gap-1">
              <Camera className="size-5" aria-hidden />
              {photo ? t('session.photoChosen', { name: photo.name }) : t('session.takePhoto')}
            </span>
          </button>
          <Field label={t('part.name')}>
            {(id) => (
              <TextInput
                ref={nameInput}
                id={id}
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void checkSimilar()}
              />
            )}
          </Field>
          <AmountFields value={amount} onChange={setAmount} />
          <Field label={t('session.orderNo')} hint={t('common.optional')}>
            {(id) => (
              <TextInput
                id={id}
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                onBlur={() => void checkSimilar()}
                className="font-mono"
              />
            )}
          </Field>
          {similar.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-warn-soft p-3">
              <span className="text-sm font-medium text-warn">{t('session.similar')}</span>
              {similar.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/p/${m.code}`} className="min-w-0 truncate hover:underline">
                    {m.name}
                  </Link>
                  <Button small onClick={() => void addToExisting(m)} disabled={!a || busy}>
                    {t('session.addHere')}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <ErrorBox error={create.error ?? upload.error ?? attach.error ?? addStock.error} />
          <Button type="submit" variant="primary" busy={busy} disabled={!a}>
            {t('session.saveNext')}
          </Button>
        </Card>
      </form>
      {added.length > 0 && (
        <Card>
          <ul className="flex flex-col gap-1.5">
            {added.map((item, i) => (
              <li
                key={`${item.code}-${i}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <Link
                  to={`/p/${item.code}`}
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  <span className="truncate">{item.name}</span>
                  <CodeLabel code={item.code} />
                </Link>
                <AmountPill display={item.display} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
