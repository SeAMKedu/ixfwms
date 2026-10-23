#!/usr/bin/env node
// Cuts a release: runs the check tier for the release type, bumps versions,
// writes CHANGELOG.md with git-cliff, commits and tags. Does not push.
//   npm run release -- patch|minor|major [--dry-run]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const type = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const explicit = /^\d+\.\d+\.\d+$/.test(type ?? '') ? type : null;
if (!explicit && !['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: npm run release -- patch|minor|major|X.Y.Z [--dry-run]');
  process.exit(2);
}

const sh = (cmd, opts = {}) => {
  const res = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    stdio: opts.capture ? 'pipe' : 'inherit',
  });
  if (res.status !== 0) {
    console.error(`\n✘ Failed: ${cmd}${res.stderr ? `\n${res.stderr}` : ''}`);
    process.exit(1);
  }
  return (res.stdout ?? '').trim();
};

if (sh('git status --porcelain', { capture: true })) {
  console.error('✘ Working tree is not clean. Commit or stash first.');
  process.exit(1);
}
const branch = sh('git rev-parse --abbrev-ref HEAD', { capture: true });
if (branch !== 'main' && !branch.startsWith('hotfix/')) {
  console.error(`✘ Releases are cut from main (or hotfix/*), you are on ${branch}.`);
  process.exit(1);
}

sh(`node scripts/check.mjs ${type === 'patch' ? 'patch' : 'release'}`);

const PACKAGES = [
  'package.json',
  'packages/domain/package.json',
  'apps/server/package.json',
  'apps/web/package.json',
];
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const [major, minor, patch] = root.version.split('.').map(Number);
const next = explicit
  ? explicit
  : type === 'major'
    ? `${major + 1}.0.0`
    : type === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const tag = `v${next}`;
console.log(`\nReleasing ${root.version} → ${next}${dryRun ? ' (dry run)' : ''}`);
if (dryRun) process.exit(0);

for (const file of PACKAGES) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = next;
  for (const deps of [pkg.dependencies, pkg.devDependencies])
    if (deps?.['@ixfwms/domain']) deps['@ixfwms/domain'] = next;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
sh('npm install --package-lock-only --ignore-scripts --no-audit --no-fund');
sh(`npx git-cliff --tag ${tag} -o CHANGELOG.md`);
sh(`git add ${PACKAGES.join(' ')} package-lock.json CHANGELOG.md`);
sh(`git commit -m "chore(release): ${tag}"`);
sh(`git tag -a ${tag} -m "ixfwms ${tag}"`);

console.log(`\n✔ Tagged ${tag}. Next:
  docker build -t ixfwms:${next} -t ixfwms:latest .
  git push --follow-tags   (when a remote exists)`);
