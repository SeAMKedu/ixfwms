import { resolve } from 'node:path';

export interface Config {
  dataDir: string;
  dbUrl: string;
  host: string;
  port: number;
  /**
   * Base URL printed into QR labels and returned to AI clients, e.g. https://ixf.local.
   * Optional: when unset, it is taken from each request's Host header, so the same build
   * works on a laptop, a test server and the lab box without changes.
   */
  publicUrl: string | null;
  logLevel: string;
  trustProxy: boolean;
  maxUploadMb: number;
  backupKeep: number;
  /** Hour (0-23, local time) for the nightly backup; -1 disables it. */
  backupHour: number;
  /** Built web app to serve; null means apps/web/dist next to the server. */
  webDir: string | null;
}

function int(value: string | undefined, fallback: number): number {
  const n = value == null || value === '' ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // INIT_CWD: npm runs workspace scripts inside apps/server; keep data next to where the command was typed.
  const dataDir = resolve(env.IXF_DATA_DIR ?? resolve(env.INIT_CWD ?? '.', 'data'));
  return {
    dataDir,
    dbUrl: env.IXF_DB_URL ?? `file:${resolve(dataDir, 'ixfwms.db')}`,
    host: env.IXF_HOST ?? '0.0.0.0',
    port: int(env.IXF_PORT, 3000),
    publicUrl: env.IXF_PUBLIC_URL?.replace(/\/+$/, '') || null,
    logLevel: env.IXF_LOG_LEVEL ?? 'info',
    trustProxy: env.IXF_TRUST_PROXY === 'true',
    maxUploadMb: int(env.IXF_MAX_UPLOAD_MB, 100),
    backupKeep: int(env.IXF_BACKUP_KEEP, 14),
    backupHour: int(env.IXF_BACKUP_HOUR, 3),
    webDir: env.IXF_WEB_DIR ? resolve(env.IXF_WEB_DIR) : null,
  };
}
