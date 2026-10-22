#!/usr/bin/env node
// Tiered quality checks. Same commands locally, in git hooks and in any future CI.
//   node scripts/check.mjs check     fast: format, lint, types, unit tests (pre-push)
//   node scripts/check.mjs patch     + integration tests            (patch releases)
//   node scripts/check.mjs release   + coverage, dead code, audit    (minor/major releases)
import { spawnSync } from 'node:child_process';

const TIERS = {
  check: [
    ['format', 'npm run format:check'],
    ['lint', 'npm run lint'],
    ['types', 'npm run typecheck'],
    ['unit tests', 'npm run test:unit'],
  ],
  patch: [['integration tests', 'npm run test:integration']],
  release: [
    ['coverage', 'npm run test:coverage'],
    ['unused code and dependencies', 'npx knip'],
    ['dependency audit (runtime deps)', 'npm audit --omit=dev --audit-level=high'],
    ['container scan', 'trivy --version', { optional: 'Trivy not installed, skipping image scan' }],
  ],
};
const ORDER = ['check', 'patch', 'release'];

const tier = process.argv[2] ?? 'check';
if (!ORDER.includes(tier)) {
  console.error(`Unknown tier "${tier}". Use one of: ${ORDER.join(', ')}`);
  process.exit(2);
}

const steps = ORDER.slice(0, ORDER.indexOf(tier) + 1).flatMap((t) => TIERS[t]);
for (const [name, command, opts] of steps) {
  if (opts?.optional && name === 'container scan') {
    const probe = spawnSync(command, { shell: true, stdio: 'ignore' });
    if (probe.status !== 0) {
      console.log(`\n▸ ${name}: ${opts.optional}`);
      continue;
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
