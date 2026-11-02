# Contributing

## Branches

- `main` is always releasable. Nothing is committed to it directly, apart from release commits.
- Work on short-lived branches from `main`: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`. Merge them back when the checks pass.
- `hotfix/<x.y.z>` branches from a release tag when a fix is needed while `main` has unreleased work.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `docs: …`, `chore: …`), enforced by a commit-msg hook. The changelog is generated from these messages.

## Checks

Every check is an npm script, so it works the same on macOS, Windows, Linux and in any future CI.

| Command                 | Runs                                                                                                      | When                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run check`         | format, lint, typecheck, unit tests                                                                       | automatically before every push (lefthook) |
| `npm run check:patch`   | + integration tests                                                                                       | patch releases                             |
| `npm run check:release` | + coverage thresholds, unused code (knip), runtime dependency audit, container scan if Trivy is installed | minor and major releases                   |

Git hooks are installed by `npm install` (lefthook). Pre-commit formats and lints the staged files.

## Releases

```bash
npm run release -- patch    # bug fixes
npm run release -- minor    # features, additive migrations
npm run release -- major    # breaking API/MCP/schema changes
npm run release -- 0.7.0    # or an explicit version, e.g. to match a roadmap milestone
```

The release script must run on `main` with a clean tree. It runs the matching check tier (the full one for anything but a patch), bumps versions, writes `CHANGELOG.md` with git-cliff, commits and tags `vX.Y.Z`. Then build the image with `docker build -t ixfwms:X.Y.Z .`.

## Database changes

Edit `apps/server/src/db/schema.ts`, then run `npm run db:generate` and commit the generated SQL in `apps/server/drizzle/`. The server applies pending migrations at startup, after taking a backup. Then run `npm run docs:data-model` to redraw the data model (`docs/data-model.html`); it fails if a drawn column is gone or a new foreign key isn't drawn, and the fix is in `scripts/data-model.ts`.

## Database portability

SQLite now; Postgres should stay possible later. The goal is not a database-agnostic app but services free of SQLite-only APIs, so a port touches `db/schema.ts`, `db/dialect.ts`, `db/client.ts`, the migrations, the code triggers and `services/backup.ts`, and not the services.

- Build queries with Drizzle and read rows through `one()` and `many()` from `db/client.ts`, never `.get()` or `.all()` (only the SQLite drivers have them).
- Raw `sql` only for SQL both databases understand: `substr`, `||`, `coalesce`, `cast`, `exists`, `count`, `case`, `like … escape`. Not `lower()`: SQLite folds only A–Z, Postgres folds ä. Case-insensitive matching compares text folded in JavaScript (`fold()` in the domain package), e.g. the stored `search_text` columns.
- No SQLite types in services (`SQLiteColumn` and the like); use Drizzle's `AnyColumn`.
- Anything specific to one database goes in `apps/server/src/db/dialect.ts`: JSON access, the timestamp default for raw SQL, and which database rule an error broke.
- The app writes timestamps itself (`nowIso()`); SQL defaults are only for raw SQL.
- Portable column types: text ids (UUIDv7), ISO-8601 text timestamps, integers for booleans, JSON as text, `real` for amounts, CHECK constraints in a form both accept.
- Database-level rules (unique codes) are triggers in a migration; Postgres would get the same rules as trigger functions in its own migration.
