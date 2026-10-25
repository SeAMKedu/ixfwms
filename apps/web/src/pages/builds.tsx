import type { BuildBrief } from '@ixfwms/domain';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useBuilds, useMakeBuild } from '../api/builds';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  PlaceTag,
  TextInput,
} from '../components/ui';
import { formatDate } from '../lib/format';

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-[13px] whitespace-nowrap ${active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`;

/** A new, empty build: name, where it sits, who to ask. Parts go in from its page. */
function NewBuildForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const make = useMakeBuild();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [contact, setContact] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const made = await make.mutateAsync({
      name: name.trim(),
      parent: parent || null,
      contact: contact.trim() || null,
      lines: [],
    });
    onDone();
    void navigate(`/l/${made.build.code}`);
  };
  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('builds.name')}>
            {(id) => (
              <TextInput
                id={id}
                required
                autoFocus
                value={name}
                placeholder={t('builds.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('builds.sitsIn')}>
            {(id) => <PlacePicker id={id} value={parent} onChange={setParent} />}
          </Field>
          <Field label={t('builds.contact')}>
            {(id) => (
              <TextInput id={id} value={contact} onChange={(e) => setContact(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={make.isPending} disabled={!name.trim()}>
            {t('builds.create')}
          </Button>
          <Button onClick={onDone}>{t('common.cancel')}</Button>
        </div>
        <ErrorBox error={make.error} />
      </form>
    </Card>
  );
}

function BuildList({ builds, dismantled }: { builds: BuildBrief[]; dismantled: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="overflow-hidden rounded-xl border border-line bg-surface">
      {builds.map((b) => (
        <li key={b.id} className="border-t border-line first:border-t-0">
          <Link
            to={`/l/${b.code}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 hover:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{b.name}</span>
              <span className="block truncate text-[12.5px] text-muted">
                {dismantled
                  ? t('builds.dismantledOn', { date: formatDate(b.dismantledAt!) })
                  : [t('builds.items', { count: b.items }), b.contact].filter(Boolean).join(' · ')}
              </span>
            </span>
            {b.in && <PlaceTag place={b.in} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Things made from parts: what stands where, and what has been taken apart. */
export function BuildsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [dismantled, setDismantled] = useState(false);
  const [adding, setAdding] = useState(false);
  const builds = useBuilds(dismantled);
  return (
    <>
      <PageHeader
        title={t('builds.title')}
        meta={builds.data && t('builds.count', { count: builds.data.length })}
        actions={
          can('inventory') && (
            <Button variant="primary" onClick={() => setAdding((a) => !a)}>
              <Plus className="size-4" aria-hidden />
              {t('builds.new')}
            </Button>
          )
        }
      />
      <p className="max-w-prose text-sm text-muted">{t('builds.intro')}</p>
      {adding && <NewBuildForm onDone={() => setAdding(false)} />}
      <div className="flex gap-2">
        <button type="button" className={chip(!dismantled)} onClick={() => setDismantled(false)}>
          {t('builds.standing')}
        </button>
        <button type="button" className={chip(dismantled)} onClick={() => setDismantled(true)}>
          {t('builds.dismantledList')}
        </button>
      </div>
      <ErrorBox error={builds.error} />
      {builds.isPending ? (
        <Loading />
      ) : builds.data?.length ? (
        <BuildList builds={builds.data} dismantled={dismantled} />
      ) : (
        <Empty>{t(dismantled ? 'builds.noneDismantled' : 'builds.none')}</Empty>
      )}
    </>
  );
}
