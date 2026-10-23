import {
  COLOUR_PALETTE,
  nearestColourName,
  paletteColour,
  toColourValue,
  type ColourValue,
} from '@ixfwms/domain';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select } from './ui';

function Swatch({ hex, size = 'md' }: { hex: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full border border-black/20 ${size === 'sm' ? 'size-3.5' : 'size-5'}`}
      style={{ background: hex }}
    />
  );
}

/** A colour as people read it: swatch, translated name, and the exact shade when it isn't the palette's. */
export function ColourText({ value }: { value: unknown }) {
  const { t } = useTranslation();
  const colour = toColourValue(value);
  if (!colour) return null;
  const custom = colour.name ? paletteColour(colour.name)?.hex !== colour.hex : true;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Swatch hex={colour.hex} size="sm" />
      {colour.name ? t(`colours.${colour.name}`, { defaultValue: colour.name }) : colour.hex}
      {custom && <span className="font-mono text-[11px] text-muted">{colour.hex}</span>}
    </span>
  );
}

/**
 * Palette swatches plus a free colour picker. Stores { name, hex }: a swatch sets both, a custom
 * shade keeps its hex and is named after the nearest palette colour (changeable).
 */
export function ColourPicker({
  id,
  label,
  value,
  onChange,
  only,
}: {
  id: string;
  label: string;
  value: ColourValue | null;
  onChange: (v: ColourValue | null) => void;
  /** Restrict the swatches to these palette names (the field's choices); empty = whole palette. */
  only?: string[] | null;
}) {
  const { t } = useTranslation();
  const palette = only?.length
    ? COLOUR_PALETTE.filter((c) => only.includes(c.name))
    : COLOUR_PALETTE;
  const custom = value ? paletteColour(value.name ?? '')?.hex !== value.hex : false;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {palette.map((c) => {
          const selected = value?.name === c.name && !custom;
          return (
            <button
              key={c.name}
              type="button"
              role="radio"
              aria-checked={selected}
              title={t(`colours.${c.name}`)}
              aria-label={t(`colours.${c.name}`)}
              onClick={() => onChange({ name: c.name, hex: c.hex })}
              className={`grid size-7 place-items-center rounded-full border ${selected ? 'border-ink ring-2 ring-link' : 'border-black/20'}`}
              style={{ background: c.hex }}
            >
              {selected && <Check className="size-4 text-white mix-blend-difference" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <label className="inline-flex items-center gap-1.5">
          <input
            id={id}
            type="color"
            value={value?.hex ?? '#888888'}
            onChange={(e) =>
              onChange({ name: nearestColourName(e.target.value), hex: e.target.value })
            }
            className="h-7 w-9 cursor-pointer rounded border border-line bg-surface p-0.5"
          />
          {t('colourPicker.custom')}
        </label>
        {value && custom && (
          <label className="inline-flex items-center gap-1.5 text-muted">
            {t('colourPicker.countsAs')}
            <Select
              value={value.name ?? ''}
              onChange={(e) => onChange({ name: e.target.value, hex: value.hex })}
              className="!w-auto !py-1 text-[13px]"
            >
              {COLOUR_PALETTE.map((c) => (
                <option key={c.name} value={c.name}>
                  {t(`colours.${c.name}`)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-muted hover:text-link"
          >
            <X className="size-3.5" aria-hidden />
            {t('colourPicker.clear')}
          </button>
        )}
        {value && <ColourText value={value} />}
      </div>
    </div>
  );
}
