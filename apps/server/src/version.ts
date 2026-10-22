import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The release version, read from the repository's root package.json (bumped by `npm run release`). */
export function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', '..', '..', 'package.json'),
    join(here, '..', 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'ixfwms' && pkg.version) return pkg.version;
    } catch {
      // try the next location
    }
  }
  return '0.0.0';
}
