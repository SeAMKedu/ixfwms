import type { MapCheck, MapLayer } from '@ixfwms/domain';
import { Link2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSetMapLink } from '../api/maps';
import { PlacePicker } from './place-picker';
import { MapView } from './svg-map';
import { Button, CodeLabel, ErrorBox, Field } from './ui';

/** Click a shape, then the place it stands for. */
export function LinkEditor({
  code,
  layer,
  check,
}: {
  code: string;
  layer: MapLayer;
  check: MapCheck;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<{ key: string; parents: string[] } | null>(null);
  const [other, setOther] = useState('');
  const setLink = useSetMapLink(code);
  const kind = layer.kind;
  const current = selected ? check.links.find((l) => l.elementKey === selected.key) : undefined;
  const link = async (target: string | null) => {
    if (!selected) return;
    await setLink.mutateAsync({ kind, elementKey: selected.key, target });
    setOther('');
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <MapView
        layer={layer}
        editing={{
          selected: selected?.key ?? null,
          onSelect: (key, parents) => setSelected(key ? { key, parents } : null),
        }}
      />
      <div className="flex flex-col gap-3 text-sm">
        {!selected ? (
          <p className="text-muted">{t('maps.pickShape')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-muted">{t('maps.selectedShape')}</span>
              <span className="flex flex-wrap items-center gap-2">
                <CodeLabel code={selected.key} />
                {current && (
                  <span>
                    → <Link to={`/l/${current.code}`}>{current.name}</Link>
                    {current.auto && <span className="text-muted"> ({t('maps.byName')})</span>}
                  </span>
                )}
              </span>
              {selected.parents[0] && (
                <Button
                  small
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    setSelected({ key: selected.parents[0]!, parents: selected.parents.slice(1) })
                  }
                >
                  {t('maps.selectGroup', { id: selected.parents[0] })}
                </Button>
              )}
            </div>
            {check.notLinked.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted">{t('maps.linkTo')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {check.notLinked.map((p) => (
                    <Button
                      key={p.code}
                      small
                      busy={setLink.isPending && setLink.variables?.target === p.code}
                      onClick={() => void link(p.code)}
                    >
                      <Link2 className="size-3.5" aria-hidden />
                      {p.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Field label={t('maps.linkOther')}>
              {(id) => (
                <PlacePicker
                  id={id}
                  value={other}
                  onChange={(c) => {
                    setOther(c);
                    if (c) void link(c);
                  }}
                  exclude={(p) => p.code === code || !p.pathCodes.includes(code)}
                />
              )}
            </Field>
            {current && !current.auto && (
              <Button small variant="ghost" className="self-start" onClick={() => void link(null)}>
                <Unlink className="size-4" aria-hidden />
                {t('maps.unlink')}
              </Button>
            )}
          </>
        )}
        <ErrorBox error={setLink.error} />
      </div>
    </div>
  );
}
