import { normalizeCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { PlacePicker } from './place-picker';
import { Button, ErrorBox, Field, TextInput } from './ui';

/**
 * "Wrong or lost label?": adopt the sticker that is actually on the thing, get a fresh code to
 * print, or (places) swap codes with the place whose sticker it got. Old codes are retired.
 */
export function LabelFix({ kind, code }: { kind: 'location' | 'part'; code: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [sticker, setSticker] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const base = kind === 'location' ? `/api/locations/${code}` : `/api/parts/${code}`;
  const page = (c: string) => (kind === 'location' ? `/l/${c}` : `/p/${c}`);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      void navigate(page(next), { replace: true });
      setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const adopt = (e: FormEvent) => {
    e.preventDefault();
    void run(
      async () =>
        (await api<{ code: string }>(`${base}/code`, { body: { code: normalizeCode(sticker) } }))
          .code,
    );
  };
  const fresh = () =>
    void run(
      async () => (await api<{ code: string }>(`${base}/code`, { body: { code: null } })).code,
    );
  const swap = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`${base}/swap-code`, { body: { with: other } });
      return other; // this place now carries the other place's old code
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[13px] text-link hover:underline"
      >
        {t('labelFix.open')}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-3 text-sm">
      <form onSubmit={adopt} className="flex flex-wrap items-end gap-2">
        <Field label={t('labelFix.sticker')} hint={t('labelFix.stickerHint')}>
          {(id) => (
            <TextInput
              id={id}
              required
              autoCapitalize="characters"
              value={sticker}
              onChange={(e) => setSticker(e.target.value)}
              className="!w-36 font-mono"
            />
          )}
        </Field>
        <Button type="submit" busy={busy}>
          {t('labelFix.useSticker')}
        </Button>
      </form>
      {kind === 'location' && (
        <form onSubmit={swap} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label={t('labelFix.swapWith')} hint={t('labelFix.swapHint')}>
              {(id) => (
                <PlacePicker
                  id={id}
                  value={other}
                  onChange={setOther}
                  exclude={(p) => p.code === code}
                />
              )}
            </Field>
          </div>
          <Button type="submit" busy={busy} disabled={!other}>
            {t('labelFix.swap')}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={fresh} busy={busy}>
          {t('labelFix.fresh')}
        </Button>
        <span className="text-[12px] text-muted">{t('labelFix.freshHint')}</span>
      </div>
      <ErrorBox error={error} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="self-start text-[13px] text-muted hover:text-link"
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}
