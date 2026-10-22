# ixfwms

Parts inventory for the robotics lab: pneumatics, electrical parts, fasteners, filament. It tracks how much of each part we have and exactly where it is (lab › cabinet › shelf › box), uses QR labels, and lets AI assistants work with it over MCP.

Status: **0.2 in progress**. It has a REST API, an MCP server for AI assistants, and a responsive web app (search, part and place pages, Inbox review, editing, login). Camera scanning and QR label printing come in 0.3. See [PLAN.md](PLAN.md) for the full plan and roadmap.

## Run it

### On a laptop (macOS, Windows, Linux)

Needs Node.js 22.12 or newer.

```bash
npm install
npm run cli -- init
npm run cli -- user:create --name yourname --role admin
npm run cli -- user:password --name yourname    # for logging in to the web app
npm run cli -- token:create --user yourname --name laptop --scopes admin    # for scripts and AI assistants
```

Then either:

- **Use it:** `npm run build && npm start`. Everything is at <http://localhost:3000>.
- **Develop it:** `npm run dev` (API on :3000) plus `npm run dev:web` (web app with hot reload on <http://localhost:5173>, proxying the API).

Data lives in `./data`. `token:create` prints an API token once, so keep it somewhere safe. Roles: `viewer` (read only), `member` (add, move, edit, confirm drafts), `admin` (everything).

### With Docker (test server, lab box)

```bash
cp .env.example .env        # adjust per environment
docker compose up -d --build
docker compose exec ixfwms node apps/server/dist/cli.js user:create --name yourname --role admin
docker compose exec ixfwms node apps/server/dist/cli.js token:create --user yourname --scopes admin
```

All state (database, uploaded files, backups) lives in the `ixfwms-data` volume. For HTTPS, which the phone camera scanner needs from 0.3, use `docker compose --profile https up -d` and set `IXF_SITE_ADDRESSES` in `.env`.

## Configuration

Everything is optional and set with environment variables (or `.env` with Docker). See [.env.example](.env.example).

| Variable                              | Default            |                                                                                                                                                                                                |
| ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IXF_PUBLIC_URL`                      | _(request host)_   | Base URL for QR labels and AI clients. When empty, each request's own host is used, so the same build works on `localhost`, an IP, `ixf.local` or any DNS name. Set it before printing labels. |
| `IXF_DATA_DIR`                        | `./data`           | Database, files and backups                                                                                                                                                                    |
| `IXF_PORT` / `IXF_HOST`               | `3000` / `0.0.0.0` |                                                                                                                                                                                                |
| `IXF_TRUST_PROXY`                     | `false`            | `true` behind Caddy or another proxy                                                                                                                                                           |
| `IXF_BACKUP_HOUR` / `IXF_BACKUP_KEEP` | `3` / `14`         | Nightly SQLite snapshot (`-1` disables)                                                                                                                                                        |
| `IXF_MAX_UPLOAD_MB`                   | `100`              |                                                                                                                                                                                                |
| `IXF_WEB_DIR`                         | `apps/web/dist`    | Built web app to serve                                                                                                                                                                         |

QR labels encode `…/L/<code>` (places) and `…/P/<code>` (parts). Codes never change, and scanners ignore the host part, so labels survive a rename of the server.

## Connect an AI assistant (MCP)

The MCP endpoint is `<base URL>/mcp` (Streamable HTTP). It uses the same API tokens as the REST API. For Claude Code:

```bash
claude mcp add --transport http ixfwms http://localhost:3000/mcp --header "Authorization: Bearer ixf_..."
```

Give assistants a token with the `inventory` scope. They can then create places, add drafts and move stock, but not confirm drafts. See [docs/inventory-with-mcp.md](docs/inventory-with-mcp.md) for the initial-inventory workflow.

## API in short

Reads are open on the lab network; writes need `Authorization: Bearer <token>`.

|                                                                                                                                         |                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/parts?q=&category=&tag=&status=&location=&inStock=`                                                                           | search                                                   |
| `GET /api/parts/:code` · `POST /api/parts` · `PATCH /api/parts/:code` · `POST /api/parts/similar`                                       | parts                                                    |
| `GET /api/locations?parent=&tree=1` · `GET /api/locations/:code?recursive=1` · `POST /api/locations` · `POST /api/locations/:code/move` | places                                                   |
| `POST /api/stock` · `POST /api/stock/:lotId/take` · `/stocktake` · `/move`                                                              | stock                                                    |
| `POST /api/files` (multipart `file`) · `GET /api/files/:id` · `POST /api/attachments`                                                   | files                                                    |
| `GET /api/export`                                                                                                                       | everything as JSON                                       |
| `POST /api/session` · `GET /api/session` · `DELETE /api/session`                                                                        | web login (name + password)                              |
| `POST /api/parts/:code/merge`                                                                                                           | merge a duplicate into another part                      |
| `GET /l/:code`, `GET /p/:code`                                                                                                          | the web app's place and part pages (what QR labels open) |

Token scopes: `read` < `inventory` (create and move things, drafts only) < `write` (confirm drafts, archive) < `admin`.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits, checks and releases.

```
packages/domain   pure domain logic, shared zod schemas and API types (no I/O)
apps/server       Fastify REST API, MCP server, SQLite via Drizzle, admin CLI
apps/web          React web app (Vite, Tailwind, TanStack Query, i18next)
scripts/          check tiers and release script
deploy/           Caddy config
```
