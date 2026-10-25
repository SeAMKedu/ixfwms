import type { PartSummary, SimilarPart } from '@ixfwms/domain';
import { Camera } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useAttach, useCreatePart, useLocation, useUpload } from '../api/queries';
import { useSession } from '../auth/session';
import { AmountFields, toAmountInput, useAmountState } from '../components/amount-fields';
import { ItemSuggest } from '../components/item-suggest';
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
import { ChosenItem, type Added } from './session/chosen-item';

/**
 * Inventory session: photo, name, amount, save, next. New items land as drafts in this place;
 * an existing one picked from the suggestions gets the amount here instead, and in a build it
 * comes from free stock.
 */
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
  const [chosen, setChosen] = useState<PartSummary | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const create = useCreatePart();
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
    setChosen(null);
    setAmount((s) => ({ ...s, quantity: '' }));
    if (photoInput.current) photoInput.current.value = '';
    nameInput.current?.focus();
  };

  /** By order number: names are suggested as they're typed (ItemSuggest). */
  const checkSimilar = async () => {
    if (!orderNo.trim()) return setSimilar([]);
    const found = await api<SimilarPart[]>('/api/parts/similar', {
      body: { name: null, identifiers: [orderNo] },
    }).catch(() => []);
    setSimilar(found.slice(0, 3));
  };

  const attachPhoto = async (partCode: string) => {
    if (!photo) return;
    const file = await upload.mutateAsync(photo);
    await attach.mutateAsync({
      owner: 'part',
      ref: partCode,
      kind: 'photo',
      fileId: file.id,
      title: photo.name,
    });
  };
  const addedOne = async (item: Added) => {
    await attachPhoto(item.code);
    setAdded((list) => [item, ...list]);
    reset();
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
    await addedOne({ code: part.code, name: part.name, display: part.lots[0]?.display ?? '' });
  };

  const busy = create.isPending || upload.isPending || attach.isPending;
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
        {chosen ? (
          <ChosenItem
            part={chosen}
            place={here}
            onClear={() => setChosen(null)}
            onAdded={addedOne}
          />
        ) : (
          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
            <Field label={t('part.name')}>
              {(id) => (
                <ItemSuggest
                  inputRef={nameInput}
                  id={id}
                  value={name}
                  onChange={setName}
                  onPick={setChosen}
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
                    <Button small onClick={() => setChosen(m)}>
                      {t('session.useThis')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <ErrorBox error={create.error} />
            <Button type="submit" variant="primary" busy={busy} disabled={!a}>
              {t('session.saveNext')}
            </Button>
          </form>
        )}
        <ErrorBox error={upload.error ?? attach.error} />
      </Card>
      {added.length > 0 && (
        <Card>
          <ul className="flex flex-col gap-1.5">
            {added.map((item, i) => (
              <li key={`${item.code}-${i}`} className="flex flex-col text-sm">
                <span className="flex items-center justify-between gap-2">
                  <Link
                    to={`/p/${item.code}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <span className="truncate">{item.name}</span>
                    <CodeLabel code={item.code} />
                  </Link>
                  {item.display && <AmountPill display={item.display} />}
                </span>
                {item.note && <span className="text-[12.5px] text-warn">{item.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
