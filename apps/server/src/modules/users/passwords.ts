import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Password hashes: scrypt, with its settings stored in the hash so old ones still check. */
const SCRYPT = { N: 131072, r: 8, p: 1, keylen: 32 } as const;
/** N=2^17 needs 128 MiB (128·N·r); Node's default limit is 32 MiB. */
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { ...SCRYPT, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  return timingSafeEqual(key, expected);
}

/** True for a hash made with weaker settings than today's, so it's redone at the next login. */
export function weakHash(stored: string): boolean {
  return Number(stored.split('$')[1]) < SCRYPT.N;
}

let standIn: Promise<string> | undefined;

/** Stands in for a password when the name is unknown, so both take as long to check. */
export function unknownUserHash(): Promise<string> {
  standIn ??= hashPassword(randomBytes(16).toString('base64'));
  return standIn;
}
