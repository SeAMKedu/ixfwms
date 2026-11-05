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

## Code layout

Code is grouped by feature, so a new feature is mostly new files in a folder of its own rather than a few more lines in every shared file.

### Server modules

`apps/server/src/modules/<feature>/` has one folder for each thing the lab does: places, parts, units, stock, loans, builds, maps and so on. Each module has these files, when it needs them:

| File            | Holds                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| `<feature>.ts`  | the service: the changes (create, update, move…) and anything not big enough to split |
| `store.ts`      | row types, `resolve()`, summaries: the read-only access other modules need            |
| `views.ts`      | what the API and MCP read: detail pages, lists, projections                           |
| `rules.ts`      | checks other modules make before they change something, e.g. `checkNotLent`           |
| `routes.ts`     | HTTP routes, `export function <feature>Routes(app: FastifyInstance, deps: AppDeps)`   |
| `tools.ts`      | MCP tools, `export function <feature>Tools(server: McpServer, ctx: ToolContext)`      |
| `<sub-part>.ts` | a part that is a feature of its own inside the module, named for it (`place-copy.ts`) |
| `*.test.ts`     | tests, next to what they test                                                         |

A module starts with `<feature>.ts`, `routes.ts` and `tools.ts`. When `<feature>.ts` gets near the size limit, split it into the roles above, not by whatever part is closest to hand.

A split service stays one object. The reads become a class in `views.ts`, or in `store.ts` when other modules mostly use them to look things up, and the service extends that class with the changes: `LocationService extends PlaceStore`, `PartService extends PartViews`, and likewise for units and maps. Routes and tools keep calling `services.parts`, and a module that only reads takes the narrower type (`PlaceStore`, `PartViews`, `UnitViews`).

- **Dependencies between modules.** Depend on the narrowest piece: another module's store, views or `rules.ts` when that's all you use, not its whole service. Import types with `import type`. A value import goes to `store.ts` or `rules.ts`, and never forms a cycle.
- **Wiring.** `modules/index.ts` builds the services (`createServices`) and lists every module's routes and tools. `http/app.ts` and `mcp/server.ts` only walk those lists. A new module is a folder plus its lines in `modules/index.ts`.
- **Shared plumbing.** Who is asking and the audit log are in `lib/context.ts`, next to errors and ids in `lib/`. The database is in `db/`. `db/schema.ts` stays one file, because drizzle-kit and the data model drawing read it.
- **MCP tools.** Tools are thin: parse, call the service, add links (`ctx.links`). A new tool's input is the domain schema (`...SomeInput.shape`), with the field descriptions in the schema (`.describe()`), so the route and the tool take the same input. The build and place tools still spell out some fields inline; move those to the schema when you touch them. A single `ref` or id that the route takes from the path stays in the tool.

### Domain package

`packages/domain/src/<feature>.ts` holds a feature's request schemas (zod) and response types, and is re-exported from `index.ts`. Shared building blocks (amounts, codes, enums, errors) have files of their own.

### Web app

- `apps/web/src/api/<feature>.ts` holds a feature's query and mutation hooks. `api/client.ts` has the fetch wrapper and `useChange`.
- `pages/<page>.tsx` lays out a page, and its sections are in `pages/<page>/`.
- `components/` has what more than one page uses.

### Size limits

ESLint fails a file over 400 lines and a function over 200 (blank lines and comments not counted). Files that were over when the limits came in are listed in `eslint.config.js` as warnings. Split them in a refactor commit of their own, never inside a feature, and take them off the list.

## Checks

Every check is an npm script, so it works the same on macOS, Windows, Linux and in any future CI.

| Command                 | Runs                                                                                        | When                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run check`         | format, lint, typecheck, docs, unit tests                                                   | automatically before every push (lefthook) |
| `npm run check:patch`   | + integration tests, runtime dependency audit (fails on high or critical)                   | patch releases                             |
| `npm run check:release` | + browser tests, coverage thresholds, unused code (knip), container scan (Docker and Trivy) | minor and major releases                   |

The container scan builds the image and has [Trivy](https://trivy.dev) look for known vulnerabilities in it, including the Debian packages of the base image that `npm audit` can't see. Only high or critical findings that a newer package fixes stop a release; ones Debian hasn't fixed yet can't be acted on, so they don't (building with `--pull` picks up fixes as they ship). Install it with `brew install trivy` and have Docker running. On a machine that can't, `IXF_SKIP_IMAGE_SCAN=1` releases without the scan, and says so.

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

SQLite now; Postgres should stay possible later. The goal is not a database-agnostic app but services free of SQLite-only APIs, so a port touches `db/schema.ts`, `db/dialect.ts`, `db/client.ts`, the migrations, the code triggers and `modules/system/backup.ts`, and not the services.

- Build queries with Drizzle and read rows through `one()` and `many()` from `db/client.ts`, never `.get()` or `.all()` (only the SQLite drivers have them).
- Raw `sql` only for SQL both databases understand: `substr`, `||`, `coalesce`, `cast`, `exists`, `count`, `case`, `like … escape`. Not `lower()`: SQLite folds only A–Z, Postgres folds ä. Case-insensitive matching compares text folded in JavaScript (`fold()` in the domain package), e.g. the stored `search_text` columns.
- No SQLite types in services (`SQLiteColumn` and the like); use Drizzle's `AnyColumn`.
- Anything specific to one database goes in `apps/server/src/db/dialect.ts`: JSON access, the timestamp default for raw SQL, and which database rule an error broke.
- The app writes timestamps itself (`nowIso()`); SQL defaults are only for raw SQL.
- Portable column types: text ids (UUIDv7), ISO-8601 text timestamps, integers for booleans, JSON as text, `real` for amounts, CHECK constraints in a form both accept.
- Database-level rules (unique codes) are triggers in a migration; Postgres would get the same rules as trigger functions in its own migration.
