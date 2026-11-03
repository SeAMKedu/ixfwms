# Contributing

## Branches

- `main` is always releasable. Nothing is committed to it directly, apart from release commits.
- Work on short-lived branches from `main`: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`. Merge them back when the checks pass.
- `hotfix/<x.y.z>` branches from a release tag when a fix is needed while `main` has unreleased work.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `docs: …`, `chore: …`), enforced by a commit-msg hook. The changelog is generated from these messages.

When a change needs something done on upgrade beyond restarting the server (reprint some labels, set a new setting, tell people something moved), say so in an `Upgrade:` footer. It's listed under **Upgrading** in the release notes, as are breaking changes (`feat!:` or a `BREAKING CHANGE:` footer):

```text
feat: drawers numbered by short name

Upgrade: Give drawers short names 1, 2, 3… where they're named after their contents.
```

## Checks

Every check is an npm script, so it works the same on macOS, Windows, Linux and in any future CI.

| Command                 | Runs                                                                                                      | When                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run check`         | format, lint, typecheck, docs, unit tests                                                                 | automatically before every push (lefthook) |
| `npm run check:patch`   | + integration tests                                                                                       | patch releases                             |
| `npm run check:release` | + coverage thresholds, unused code (knip), runtime dependency audit, container scan if Trivy is installed | minor and major releases                   |

Git hooks are installed by `npm install` (lefthook). Pre-commit formats and lints the staged files.

### Docs

`node scripts/docs-check.mjs` (part of `npm run check`) fails when:

- an MCP tool isn't in the README's tool table, or the table lists one that's gone;
- an `/api/<area>` the server answers isn't in the README's API table;
- `docs/data-model.html` is out of date (it redraws it; commit the result);
- a link in a Markdown file points at a file that doesn't exist.

Code can't tell whether a feature needs its docs updated, so the script also looks at `feat:` commits: with `--since <rev>`, it lists the features since then when no README, CONTRIBUTING or `docs/*.md` changed with them. After a merge or pull (post-merge hook) that's a warning. A release stops on it; run it again with `--docs-ok` when the features really need no docs.

## Releases

```bash
npm run release -- patch    # bug fixes
npm run release -- minor    # features, additive migrations
npm run release -- major    # breaking API/MCP/schema changes
npm run release -- 0.7.0    # or an explicit version, e.g. to match a roadmap milestone
```

The release script must run on `main` with a clean tree. It checks the docs kept up with the features since the last tag (see above), runs the matching check tier (the full one for anything but a patch), bumps versions, adds the release on top of `CHANGELOG.md` with git-cliff (with the database migrations it brings listed under **Upgrading**), commits and tags `vX.Y.Z`. Then build the image with `docker build -t ixfwms:X.Y.Z .`.

## Database changes

Edit `apps/server/src/db/schema.ts`, then run `npm run db:generate` and commit the generated SQL in `apps/server/drizzle/`. The server applies pending migrations at startup, after taking a backup; the release notes list them, since going back to an older version then means restoring that backup. Then run `npm run docs:data-model` to redraw the data model (`docs/data-model.html`); it fails if a drawn column is gone or a new foreign key isn't drawn, and the fix is in `scripts/data-model.ts`.

## Database portability

SQLite now; Postgres should stay possible later. The goal is not a database-agnostic app but services free of SQLite-only APIs, so a port touches `db/schema.ts`, `db/dialect.ts`, `db/client.ts`, the migrations, the code triggers and `services/backup.ts`, and not the services.

- Build queries with Drizzle and read rows through `one()` and `many()` from `db/client.ts`, never `.get()` or `.all()` (only the SQLite drivers have them).
- Raw `sql` only for SQL both databases understand: `substr`, `||`, `coalesce`, `cast`, `exists`, `count`, `case`, `like … escape`. Not `lower()`: SQLite folds only A–Z, Postgres folds ä. Case-insensitive matching compares text folded in JavaScript (`fold()` in the domain package), e.g. the stored `search_text` columns.
- No SQLite types in services (`SQLiteColumn` and the like); use Drizzle's `AnyColumn`.
- Anything specific to one database goes in `apps/server/src/db/dialect.ts`: JSON access, the timestamp default for raw SQL, and which database rule an error broke.
- The app writes timestamps itself (`nowIso()`); SQL defaults are only for raw SQL.
- Portable column types: text ids (UUIDv7), ISO-8601 text timestamps, integers for booleans, JSON as text, `real` for amounts, CHECK constraints in a form both accept.
- Database-level rules (unique codes) are triggers in a migration; Postgres would get the same rules as trigger functions in its own migration.
