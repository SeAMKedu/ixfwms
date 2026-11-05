import { fail } from '../../lib/errors.js';

const WINDOW_MS = 10 * 60_000;
/** Failed logins per name, and per client address, inside the window. */
const MAX_PER_NAME = 10;
const MAX_PER_CLIENT = 30;
/** Password checks running at once: each scrypt takes about 128 MiB. */
const MAX_RUNNING = 4;
const MAX_RUNNING_PER_CLIENT = 2;
/** Past this many keys, expired ones are swept, so a stream of new names can't grow the map. */
const SWEEP_AT = 1000;

/**
 * Keeps login from being used to busy the box. Checked before scrypt runs: a name or an address
 * that has failed too often waits out the window, and only a few checks run at once. In memory,
 * so a restart clears it.
 */
export class LoginLimit {
  private readonly failed = new Map<string, number[]>();
  private readonly running = new Map<string, number>();
  private runningTotal = 0;

  /** Runs `check` (the password check) if the name and the client still have tries left. */
  async attempt<T>(name: string, client: string, check: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const keys = [`n:${name.toLowerCase()}`, `c:${client}`] as const;
    if (
      this.recent(keys[0], now).length >= MAX_PER_NAME ||
      this.recent(keys[1], now).length >= MAX_PER_CLIENT
    )
      throw fail('forbidden', 'auth.tooManyLogins');
    const mine = this.running.get(client) ?? 0;
    if (this.runningTotal >= MAX_RUNNING || mine >= MAX_RUNNING_PER_CLIENT)
      throw fail('forbidden', 'auth.loginsBusy');
    this.running.set(client, mine + 1);
    this.runningTotal++;
    try {
      return await check();
    } finally {
      this.runningTotal--;
      const left = (this.running.get(client) ?? 1) - 1;
      if (left) this.running.set(client, left);
      else this.running.delete(client);
    }
  }

  /** A wrong password: counts against both the name and the client. */
  failedFor(name: string, client: string): void {
    const now = Date.now();
    if (this.failed.size > SWEEP_AT)
      for (const key of this.failed.keys())
        if (!this.recent(key, now).length) this.failed.delete(key);
    for (const key of [`n:${name.toLowerCase()}`, `c:${client}`])
      this.failed.set(key, [...this.recent(key, now), now]);
  }

  /** A good password clears the name; the client's count stays, it may be guessing others. */
  succeededFor(name: string): void {
    this.failed.delete(`n:${name.toLowerCase()}`);
  }

  private recent(key: string, now: number): number[] {
    return (this.failed.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  }
}
