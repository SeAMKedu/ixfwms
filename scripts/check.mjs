#!/usr/bin/env node
// Tiered quality checks. Same commands locally, in git hooks and in any future CI.
//   node scripts/check.mjs check     fast: format, lint, types, docs, unit tests (pre-push)
//   node scripts/check.mjs patch     + integration tests, audit      (patch releases)
//   node scripts/check.mjs release   + coverage, dead code, image scan (minor/major releases)
// The image scan needs Docker and Trivy (brew install trivy). IXF_SKIP_IMAGE_SCAN=1 skips it,
// loudly, for a machine that can't run it; the release is then not scanned at all.
import { spawnSync } from 'node:child_process';

const TIERS = {
  check: [
    ['format', 'npm run format:check'],
    ['lint', 'npm run lint'],
    ['types', 'npm run typecheck'],
    ['docs', 'node scripts/docs-check.mjs'],
    ['unit tests', 'npm run test:unit'],
  ],
  patch: [
    ['integration tests', 'npm run test:integration'],
    // Lists every finding; only high and critical ones stop the release.
    ['dependency audit (runtime deps)', 'npm audit --omit=dev --audit-level=high'],
  ],
  release: [
    ['browser tests (scan, carry, take)', 'npm run test:e2e'],
    ['coverage', 'npm run test:coverage'],
    ['unused code and dependencies', 'npx knip'],
    ['container scan', 'trivy --version'],
  ],
};
const ORDER = ['check', 'patch', 'release'];

const tier = process.argv[2] ?? 'check';
if (!ORDER.includes(tier)) {
  console.error(`Unknown tier "${tier}". Use one of: ${ORDER.join(', ')}`);
  process.exit(2);
}

const steps = ORDER.slice(0, ORDER.indexOf(tier) + 1).flatMap((t) => TIERS[t]);
for (const [name, command] of steps) {
  if (name === 'container scan') {
    if (process.env.IXF_SKIP_IMAGE_SCAN === '1') {
      console.log(
        `\n⚠ ${name}: skipped (IXF_SKIP_IMAGE_SCAN=1), this release's image is not scanned`,
      );
      continue;
    }
    for (const [tool, probe] of [
      ['Trivy', command],
      ['Docker', 'docker info'],
    ]) {
      if (spawnSync(probe, { shell: true, stdio: 'ignore' }).status !== 0) {
        console.error(
          `\n✘ ${name}: ${tool} is not available. Install or start it (brew install trivy), ` +
            'or set IXF_SKIP_IMAGE_SCAN=1 to release without scanning the image.',
        );
        process.exit(1);
      }
    }
    const image = `ixfwms:check`;
    const build = spawnSync(`docker build -q -t ${image} .`, { shell: true, stdio: 'inherit' });
    if (build.status !== 0) fail(name);
    run(name, `trivy image --exit-code 1 --severity HIGH,CRITICAL ${image}`);
    continue;
  }
  run(name, command);
}
console.log(`\n✔ All "${tier}" checks passed`);

function run(name, command) {
  console.log(`\n▸ ${name}: ${command}`);
  const res = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (res.status !== 0) fail(name);
}

function fail(name) {
  console.error(`\n✘ ${name} failed`);
  process.exit(1);
}
