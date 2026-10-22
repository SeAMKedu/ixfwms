import { Camera, CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui';

/** The browser's built-in detector (Chrome on Android, some desktops). Not in TypeScript's DOM types yet. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const SCAN_INTERVAL_MS = 150;
const REPEAT_AFTER_MS = 2500;
const MAX_FRAME_WIDTH = 640;

type CameraProblem = 'denied' | 'missing' | { message: string } | null;

/**
 * Camera QR scanner. Uses the native BarcodeDetector when the browser has one, otherwise decodes
 * frames with jsQR (loaded on demand). The same code is reported again only after a pause.
 */
export function QrScanner({
  onScan,
  paused = false,
}: {
  onScan: (text: string) => void;
  paused?: boolean;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  const pausedRef = useRef(paused);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<CameraProblem>(null);
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;

  useEffect(() => {
    handler.current = onScan;
    pausedRef.current = paused;
  });

  useEffect(() => {
    if (!running || insecure) return;
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | undefined;
    let last = '';
    let lastAt = 0;

    const report = (text: string) => {
      const now = Date.now();
      if (text === last && now - lastAt < REPEAT_AFTER_MS) return;
      last = text;
      lastAt = now;
      navigator.vibrate?.(40);
      handler.current(text);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setProblem(
          name === 'NotAllowedError'
            ? 'denied'
            : name === 'NotFoundError'
              ? 'missing'
              : { message: err instanceof Error ? err.message : String(err) },
        );
        setRunning(false);
        return;
      }
      const el = video.current;
      if (stopped || !el) return stream.getTracks().forEach((track) => track.stop());
      el.srcObject = stream;
      await el.play().catch(() => {});

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && el.readyState >= 2 && el.videoWidth > 0) {
          if (detector) {
            const [code] = await detector.detect(el).catch(() => []);
            if (code?.rawValue) report(code.rawValue);
          } else if (jsQR && ctx) {
            const scale = Math.min(1, MAX_FRAME_WIDTH / el.videoWidth);
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(frame.data, frame.width, frame.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code?.data) report(code.data);
          }
        }
        timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [running, insecure]);

  const message = insecure
    ? t('scan.cameraInsecure')
    : problem === 'denied'
      ? t('scan.cameraDenied')
      : problem === 'missing'
        ? t('scan.cameraMissing')
        : problem
          ? t('scan.cameraError', { message: problem.message })
          : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#1d2429]">
        <video
          ref={video}
          playsInline
          muted
          className={`size-full object-cover ${running ? '' : 'hidden'}`}
        />
        {running && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-1/2 max-h-56 max-w-56 rounded-xl border-2 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            {message ?? (
              <Button variant="primary" onClick={() => setRunning(true)}>
                <Camera className="size-4" aria-hidden />
                {t('scan.cameraStart')}
              </Button>
            )}
          </div>
        )}
      </div>
      {running && (
        <Button small onClick={() => setRunning(false)} className="self-start">
          <CameraOff className="size-4" aria-hidden />
          {t('scan.cameraStop')}
        </Button>
      )}
    </div>
  );
}
