import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveBlob } from '../api/client';
import { useLabSettings } from '../api/queries';
import { LabelFix } from './label-fix';
import { Button, Card, ErrorBox, Segmented } from './ui';

type Tape = '9' | '12' | '24';
const PRINT_DPI = 360;

/** Renders the label SVG to a PNG at print resolution, for the Brother app on a phone. */
async function svgToPng(svgUrl: string): Promise<Blob> {
  const text = await (await fetch(svgUrl)).text();
  const mm = (attr: string) => Number(new RegExp(`${attr}="([\\d.]+)mm"`).exec(text)?.[1] ?? 0);
  const width = Math.round((mm('width') / 25.4) * PRINT_DPI);
  const height = Math.round((mm('height') / 25.4) * PRINT_DPI);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the label'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Preview and downloads for one code's label: PNG for the P-touch app, SVG, DXF for laser marking.
 * `version` changes when what the label shows may have (the page's data was fetched again), so the
 * browser doesn't keep showing the label from before a rename.
 */
export function LabelPanel({
  code,
  version,
  csvHref,
  fix,
}: {
  code: string;
  version: number;
  csvHref?: string;
  fix?: 'location' | 'part' | 'unit';
}) {
  const { t } = useTranslation();
  const settings = useLabSettings();
  const [chosen, setTape] = useState<Tape | null>(null);
  const tape = chosen ?? settings.data?.labelTape ?? '12';
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const svgUrl = `/api/labels/${code}/label.svg?tape=${tape}&v=${version}`;
  const png = async () => {
    setBusy(true);
    setError(null);
    try {
      saveBlob(await svgToPng(svgUrl), `ixfwms-${code}-${tape}mm.png`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const link = 'inline-flex items-center gap-1 text-[13px] text-link hover:underline';
  return (
    <Card title={t('labels.label')}>
      <div className="w-56">
        <Segmented<Tape>
          label={t('labels.tape')}
          value={tape}
          onChange={setTape}
          options={(['9', '12', '24'] as const).map((mm) => ({
            value: mm,
            label: t('labels.tapeMm', { mm }),
          }))}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white p-3">
        <img src={svgUrl} alt="" className="h-16 max-w-none" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button small variant="dark" busy={busy} onClick={() => void png()}>
          <Download className="size-4" aria-hidden />
          {t('labels.png')}
        </Button>
        <a className={link} href={svgUrl} download={`ixfwms-${code}-${tape}mm.svg`}>
          {t('labels.svg')}
        </a>
        <a className={link} href={`/api/labels/${code}/qr.dxf?card=1`} download>
          {t('labels.dxf')}
        </a>
        {csvHref && (
          <a className={link} href={csvHref} download>
            {t('labels.csvInside')}
          </a>
        )}
      </div>
      <ErrorBox error={error} />
      {fix && <LabelFix kind={fix} code={code} />}
    </Card>
  );
}
