#!/usr/bin/env node
// Checks that the docs keep up with the code. Same script in git hooks and releases.
//   node scripts/docs-check.mjs                    MCP tools and API areas listed in the README,
//                                                  data model drawing current, links not broken
//   node scripts/docs-check.mjs --since <rev>      also: features since <rev> that touched no docs
//   node scripts/docs-check.mjs --since <rev> --strict   ... and fail on that instead of warning
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const strict = args.includes('--strict');
const problems = [];

const git = (cmd) =>
  spawnSync(`git ${cmd}`, { shell: true, encoding: 'utf8' }).stdout?.trim() ?? '';
const sourceFiles = (dir) =>
  readdirSync(dir, { recursive: true })
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'));
const readme = readFileSync('README.md', 'utf8');

// MCP tools: the README's table lists every tool the server registers, and nothing else.
const tools = new Set(
  sourceFiles('apps/server/src').flatMap((src) =>
    [...src.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
  ),
);
const mcpSection = readme.split(/^## /m).find((s) => s.startsWith('Connect an AI assistant')) ?? '';
const listed = new Set(
  mcpSection
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .flatMap((l) => [...l.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1])),
);
const notListed = [...tools].filter((t) => !listed.has(t)).sort();
const gone = [...listed].filter((t) => !tools.has(t)).sort();
if (notListed.length)
  problems.push(`MCP tools missing from the README's tool table: ${notListed.join(', ')}`);
if (gone.length) problems.push(`README lists MCP tools that don't exist: ${gone.join(', ')}`);

// REST API: every /api/<area> the server answers is mentioned in the README's API table.
const areas = new Set(
  sourceFiles('apps/server/src').flatMap((src) =>
    [...src.matchAll(/\.(?:get|post|put|patch|delete)\(\s*'(\/api\/[^/'?]+)/g)].map((m) => m[1]),
  ),
);
const missingAreas = [...areas].filter((a) => !readme.includes(a)).sort();
if (missingAreas.length)
  problems.push(`API areas missing from the README's API table: ${missingAreas.join(', ')}`);

// Data model: redrawing it from the schema changes nothing.
const draw = spawnSync('npm run --silent docs:data-model', { shell: true, encoding: 'utf8' });
if (draw.status !== 0) problems.push(`docs/data-model.html can't be drawn:\n${draw.stderr}`);
else if (git('status --porcelain -- docs/data-model.html'))
  problems.push('docs/data-model.html was out of date and has been redrawn: commit it');

// Links between the docs point at files that exist.
for (const file of git('ls-files "*.md"').split('\n').filter(Boolean)) {
  const text = readFileSync(file, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = join(dirname(file), decodeURI(target.split('#')[0]));
    if (!existsSync(path)) problems.push(`${file}: broken link to ${target}`);
  }
}

// Features since <rev> with no docs changed at all: maybe fine, worth a look.
let warning = null;
if (since) {
  const feats = git(`log --format=%s ${since}..HEAD`)
    .split('\n')
    .filter((s) => /^feat(\(.+\))?!?:/.test(s));
  const docs = git(`diff --name-only ${since}..HEAD`)
    .split('\n')
    .filter((f) => /^(README|CONTRIBUTING)\.md$|^docs\/.*\.md$/.test(f));
  if (feats.length && !docs.length)
    warning = `${feats.length} feature(s) since ${since} and no docs changed:\n${feats
      .map((s) => `  - ${s}`)
      .join('\n')}\nCheck README.md and docs/*.md for what they should say.`;
  else if (feats.length) console.log(`▸ docs changed with the features: ${docs.join(', ')}`);
}

for (const p of problems) console.error(`✘ ${p}`);
if (warning) (strict ? console.error : console.warn)(`${strict ? '✘' : '⚠'} ${warning}`);
if (problems.length || (strict && warning)) process.exit(1);
console.log('✔ docs check passed');
