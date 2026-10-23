# ixfwms

Parts inventory for the robotics lab: pneumatics, electrical parts, fasteners, filament. It tracks how much of each part we have and exactly where it is (lab › cabinet › shelf › box), uses QR labels, and lets AI assistants work with it over MCP.

## What it does

- **Parts and stock:** parts with order numbers, categories, project tags, files (datasheets, STEP models) and stock in any number of places. Stock can be counted, weighed or length-measured (weighed fasteners show an estimated count), or just marked plenty / low / empty.
- **Places:** a tree of any depth (building › lab › cabinet › shelf › box). Every place and part has a short code printed on its QR label. A cabinet can be copied with everything inside it, e.g. six more like it.
- **Phone first:** a camera QR scanner; moving things by scanning (pick up, walk, scan where it goes); quick-add inventory sessions with photos.
- **Inbox:** new parts from imports or AI assistants arrive as drafts to review, merge or put away. Things carried for hours get flagged.
- **Category fields:** e.g. thread and length for screws, colour (palette name + exact shade) for filament and wire. Search can filter on these fields, and a low-stock list is built in.
- **Labels:** CSV for P-touch Editor, PNG for phone printing, SVG/DXF for laser marking, and batches of blank labels. Lost or misplaced labels can be retired, reassigned or swapped.
- **Lab maps:** SVG floor plans and 3D models (`.glb` from Blender). Shapes are linked to places by clicking them (or by naming them `loc-<code>`), light up for "where is it?" and are clickable. One drawing can serve many identical cabinets, and a check lists links broken by a changed drawing.
- **Can we build it?** Checks a parts list (pasted, or exported from Solid Edge, NX, Inventor, EPLAN or TIA Portal) against stock.
- **Spreadsheet import:** CSV or Excel, with column mappings you can save.
- **AI assistants (MCP):** Claude and other assistants can search, check parts lists and do the initial inventory from order emails and photos.
- **Everyday use:** login for changes (reading is open on the lab network), users and API tokens, history with undo for moves, nightly backups, English and Finnish, keyboard shortcuts.

See [PLAN.md](PLAN.md) for the background and roadmap, and [CHANGELOG.md](CHANGELOG.md) for releases. How-tos: [labels](docs/labels.md), [lab maps](docs/maps.md), [initial inventory with an AI assistant](docs/inventory-with-mcp.md).

## Run it

### On a laptop (macOS, Windows, Linux)

Needs Node.js 22.12 or newer.

```bash
npm install
npm run cli -- init
npm run cli -- user:create --name yourname --role admin
npm run cli -- user:password --name yourname
```

Then either:

- **Use it:** `npm run build && npm start`. Everything is at <http://localhost:3000>.
- **Develop it:** `npm run dev` (API on :3000) plus `npm run dev:web` (web app with hot reload on <http://localhost:5173>, proxying the API).

Log in with the admin you created. Other people and API tokens for scripts or AI assistants are added on the **Users** page (under **More** in the sidebar). Roles: `viewer` (read only), `member` (add, move, edit, confirm drafts), `admin` (everything).

Data lives in `./data`: the SQLite database, uploaded files and backups.

### With Docker (test server, lab box)

```bash
cp .env.example .env        # adjust per environment
docker compose up -d --build
docker compose exec ixfwms node apps/server/dist/cli.js user:create --name yourname --role admin
docker compose exec ixfwms node apps/server/dist/cli.js user:password --name yourname
```

All state lives in the `ixfwms-data` volume. The phone camera scanner needs HTTPS: run `docker compose --profile https up -d` with `IXF_SITE_ADDRESSES` set in `.env`. Then open **More › Phone & AI setup** on each phone to install the lab's certificate.

### Admin CLI

`npm run cli -- <command>` (or `node apps/server/dist/cli.js <command>` in Docker): `init`, `user:create`, `user:list`, `user:password`, `token:create`, `token:revoke`, `seed:categories`, `backup`. Run it without a command for help. Most of this is also in the web app.

## Keyboard shortcuts

Press `?` anywhere for the list that applies to the current page. The main ones:

| Keys                                             |                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `/`                                              | search parts                                                             |
| `g` then `p` / `i` / `l` / `s` / `c` / `h` / `b` | parts, Inbox, places, scan, carrying, history, can-we-build              |
| `n`                                              | new part                                                                 |
| `j` / `k`, Enter                                 | move through search results, open one (↓ from the search box also works) |
| `e`, `t`, `m`, `c`, `a`, `r`                     | on a part: edit, take, move, carry, add stock, mark reviewed             |
| `a`, `e`, `m`, `d`, `p`                          | on a place: add items, edit, move, copy, pick up                         |
| Tab / → in a place field                         | step into the highlighted place; Backspace steps out                     |

Shortcuts don't fire while you're typing in a field. Esc leaves the field.

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
| `IXF_CA_CERT`                         | _(none)_           | Root certificate offered on the Phone & AI setup page (set by `compose.yaml` for the https profile)                                                                                            |
| `IXF_WEB_DIR`                         | `apps/web/dist`    | Built web app to serve                                                                                                                                                                         |

QR labels encode `…/L/<code>` (places) and `…/P/<code>` (parts). Codes stay the same when things move or are renamed, and scanners ignore the host part, so labels also survive a server rename.

## Connect an AI assistant (MCP)

The MCP endpoint is `<base URL>/mcp` (Streamable HTTP). It uses the same API tokens as the REST API. Create a token on the Users page (it shows the full command), or:

```bash
claude mcp add --transport http ixfwms http://localhost:3000/mcp --header "Authorization: Bearer ixf_..."
```

Give assistants a token with the `inventory` scope. They can then create places, add drafts and move stock, but not confirm drafts.

| Tools  |                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read   | `search_parts`, `get_part`, `find_similar_parts`, `list_locations`, `get_location`, `list_categories`, `get_category_fields`, `list_tags`, `check_availability`, `get_upload_info` |
| Change | `create_location`, `duplicate_location`, `create_part_drafts`, `update_part`, `add_stock`, `take_stock`, `set_stock_amount`, `move_stock`, `move_location`, `attach_file`          |

See [docs/inventory-with-mcp.md](docs/inventory-with-mcp.md) for the initial-inventory workflow.

## API in short

Reads are open on the lab network; writes need `Authorization: Bearer <token>`. Token scopes: `read` < `inventory` (create and move things, drafts only) < `write` (confirm drafts, archive, category fields) < `admin`.

|                                                                                                                                                                                   |                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/parts?q=&category=&tag=&status=&location=&inStock=&lowStock=&attr=thread:M4`                                                                                            | search (`attr` repeats: `key:value`, `key>=n`, `key<=n`, `key~text`) |
| `GET /api/parts/:code` · `POST /api/parts` · `PATCH /api/parts/:code` · `POST /api/parts/similar` · `POST /api/parts/:code/merge` · `/status` · `/code`                           | parts                                                                |
| `GET /api/locations?parent=&tree=1&flat=1` · `GET /api/locations/:code?recursive=1` · `POST /api/locations` · `PATCH` · `/move` · `/duplicate` · `/code` · `/swap-code`           | places                                                               |
| `POST /api/stock` · `POST /api/stock/:lotId/take` · `/stocktake` · `/move`                                                                                                        | stock                                                                |
| `GET /api/carry` · `GET /api/carry/all` · `POST /api/carry/pick` · `POST /api/carry/drop`                                                                                         | scan, carry, scan                                                    |
| `GET /api/categories` · `GET /api/categories/fields?path=` · `PUT /api/categories/fields` · `POST /api/categories/starter`                                                        | categories and their fields                                          |
| `POST /api/files` (multipart `file`) · `GET /api/files/:id` · `POST /api/attachments`                                                                                             | files                                                                |
| `GET /api/labels?codes=…` · `GET /api/labels.csv?location=…&recursive=1` · `GET /api/labels/:code/label.svg?tape=12` · `/qr.svg` · `/qr.dxf`                                      | labels                                                               |
| `POST /api/labels/blank` · `GET /api/labels/batches` · `/batches/:id/labels.csv` · `POST /api/labels/retire` · `GET /api/codes/:code`                                             | blank labels and codes                                               |
| `GET /api/maps/:code` · `PUT /api/locations/:code/map` · `…/map/attach` · `PUT …/map/links` · `…/map/copy-links` · `DELETE …/map?kind=` · `GET …/map/check` · `…/map/starter.svg` | lab maps (SVG, GLB)                                                  |
| `GET` / `POST /api/map-drawings` · `PUT` / `PATCH` / `DELETE /api/map-drawings/:id`                                                                                               | shared map drawings                                                  |
| `POST /api/bom/check` · `POST /api/bom/tag`                                                                                                                                       | can we build it?                                                     |
| `POST /api/import/parts` · `GET` / `PUT /api/import/mappings`                                                                                                                     | spreadsheet import                                                   |
| `POST` / `GET` / `DELETE /api/session` · `POST /api/session/password`                                                                                                             | web login                                                            |
| `GET` / `POST /api/users` · `PATCH /api/users/:name` · `POST /api/users/:name/tokens` · `DELETE /api/tokens/:id`                                                                  | users and tokens (admin)                                             |
| `GET /api/history` · `POST /api/history/undo`                                                                                                                                     | history, undo moves                                                  |
| `GET` / `POST /api/backups` · `GET /api/backups/:name` · `GET /api/export`                                                                                                        | backups (admin), JSON export                                         |
| `GET /api/info` · `GET /api/setup` · `/api/setup/root.crt` · `/healthz`                                                                                                           | server info                                                          |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits, checks and releases.

```
packages/domain   pure domain logic, shared zod schemas and API types (no I/O)
apps/server       Fastify REST API, MCP server, SQLite via Drizzle, admin CLI
apps/web          React web app (Vite, Tailwind, TanStack Query, i18next, three.js for 3D)
scripts/          check tiers and release script
deploy/           Caddy config
docs/             how-tos
```
