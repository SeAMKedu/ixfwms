import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

const PREFIX = 'ixfwms-';

/** SQLite snapshots via VACUUM INTO: consistent even while the server is running. */
export class BackupService {
  constructor(
    private readonly client: Client,
    private readonly backupDir: string,
    private readonly keep: number,
  ) {}

  async backup(reason = 'manual'): Promise<string> {
    await mkdir(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(this.backupDir, `${PREFIX}${stamp}-${reason}.db`);
    await this.client.execute({ sql: 'VACUUM INTO ?', args: [file] });
    await this.prune();
    return file;
  }

  async list(): Promise<{ file: string; size: number }[]> {
    await mkdir(this.backupDir, { recursive: true });
    const names = (await readdir(this.backupDir)).filter((n) => n.startsWith(PREFIX)).sort();
    return Promise.all(
      names.map(async (n) => ({
        file: join(this.backupDir, n),
        size: (await stat(join(this.backupDir, n))).size,
      })),
    );
  }

  private async prune(): Promise<void> {
    const all = await this.list();
    for (const old of all.slice(0, Math.max(0, all.length - this.keep)))
      await rm(old.file, { force: true });
  }

  /** Runs a backup once a day at `hour` (local time). Returns a function that stops the schedule. */
  schedule(hour: number, onError: (err: unknown) => void): () => void {
    let lastDay = '';
    const timer = setInterval(() => {
      const now = new Date();
      const day = now.toDateString();
      if (now.getHours() === hour && day !== lastDay) {
        lastDay = day;
        this.backup('nightly').catch(onError);
      }
    }, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
}
