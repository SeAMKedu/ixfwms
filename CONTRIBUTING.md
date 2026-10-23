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

Edit `apps/server/src/db/schema.ts`, then run `npm run db:generate` and commit the generated SQL in `apps/server/drizzle/`. The server applies pending migrations at startup, after taking a backup.
