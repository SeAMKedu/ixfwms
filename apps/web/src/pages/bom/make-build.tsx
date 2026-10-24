import type { BomCheck } from '@ixfwms/domain';
import { Blocks } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMakeBuild } from '../../api/builds';
import { PlacePicker } from '../../components/place-picker';
import { Button, ErrorBox, Field, PlaceTag, TextInput } from '../../components/ui';

/** The matched parts of a checked list, each once, with whole quantities. */
function buildLines(result: BomCheck) {
  const byCode = new Map<string, number>();
  for (const l of result.lines)
    if (l.part) byCode.set(l.part.code, (byCode.get(l.part.code) ?? 0) + Math.ceil(l.quantity));
  return [...byCode].map(([part, quantity]) => ({ part, quantity }));
}

/** "Make a build from this": a new build, with the matched parts moved in from free stock. */
export function MakeBuild({ result }: { result: BomCheck }) {
  const { t } = useTranslation();
  const make = useMakeBuild();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [contact, setContact] = useState('');
  const done = make.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    make.mutate({
      name: name.trim(),
      parent: parent || null,
      contact: contact.trim() || null,
      lines: buildLines(result),
    });
  };

  if (done)
    return (
      <div role="status" className="flex flex-col gap-1 rounded-lg bg-ok-soft px-3 py-2 text-sm">
        <span className="text-ok">
          {t('builds.made', { count: done.moved.length, name: done.build.name })}
        </span>
        {done.moved.map((m, i) => (
          <span key={i} className="flex flex-wrap items-center gap-1.5">
            {m.name}
            <span className="text-muted">{m.display}</span>
            <PlaceTag place={m.from} />
          </span>
        ))}
        {done.left.length > 0 && (
          <span className="text-warn">
            {t('builds.leftToDo')}{' '}
            {done.left
              .map((l) => `${l.name} × ${l.quantity}: ${t(`builds.reasons.${l.reason}`)}`)
              .join('; ')}
          </span>
        )}
        <Link to={`/l/${done.build.code}`} className="self-start text-link hover:underline">
          {t('builds.open', { name: done.build.name })}
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-3">
      <p className="max-w-prose text-sm text-muted">{t('builds.makeIntro')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('builds.name')}>
          {(id) => (
            <TextInput
              id={id}
              required
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
      <Button type="submit" className="self-start" busy={make.isPending} disabled={!name.trim()}>
        <Blocks className="size-4" aria-hidden />
        {t('builds.make')}
      </Button>
      <ErrorBox error={make.error} />
    </form>
  );
}
