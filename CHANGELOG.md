# Changelog

All notable changes to ixfwms.
## 0.9.0 (2026-10-24)

### Features
- stock levels set in Settings
- **web:** place types as a table, one row per type with a column per setting
- **web:** page QR code on desktop, label sections only for admins
- **web:** show the label section to members too
- users list with a page per user; turn accounts off, remove unused ones
- **web:** account link as a circle with the user's name, and a Log out text link

### Fixes
- **labels:** 9 mm tool and device labels show the name above the home address

### Documentation
- plan status for 0.9
## 0.8.0 (2026-10-23)

### Features
- **server:** units, loans, problem reports and moves without an account
- **web:** items with units, loans, problem reports and workstations
- **labels:** tool and device labels show the home address instead of the code

### Fixes
- **server:** keep units, and ids made in the same millisecond, in creation order
- **web:** list reported units once in the Inbox, clearer loan return button

### Documentation
- plan items with units, loans and reports, AMR fleet link, backlog ideas
- tools, devices and units guide; README and plan for 0.8
- plan status for 0.8
## 0.7.0 (2026-10-23)

### Features
- shared lab maps linked in the app, and copying places
- readable place addresses and editable place types
- compact maps, settings sections, temporary places, import samples

### Documentation
- drop note about older label templates
- plan status for 0.7, adapters move to 0.8
## 0.6.0 (2026-10-23)

### Features
- **domain:** short codes, identifier matching, stock amounts and shared input schemas
- **server:** SQLite schema and first migration
- **server:** inventory services for places, parts, stock, files, tokens and backups
- **server:** REST API, read-only QR pages and MCP server for AI assistants
- **server:** web login with passwords and expiring sessions
- **server:** merge duplicate parts and remove wrong identifiers
- **server:** serve the built web app with a single-page-app fallback
- **web:** responsive web app for searching, browsing, editing and reviewing the inventory
- **server:** QR labels as SVG, DXF and P-touch CSV, blank labels and code lookup
- **server:** scan, carry, scan: per-person carry list for moving things
- **mcp:** register a box with the code from its blank label
- **web:** camera scanner, carry flow, inventory sessions and label downloads
- pick places by name with hierarchical search instead of typing codes
- **web:** clickable category levels on the part page
- category fields with inheritance, search on them, and a low-stock filter
- import parts from CSV or Excel with column mappings and a preview
- **web:** category editor, field inputs and filters, low stock, spreadsheet import
- check a parts list against stock and tag matched parts with a project
- **web:** can-we-build-it page for pasted or exported parts lists
- **server:** SVG lab maps per place, linked by loc:<code> ids, with starter drawings
- **web:** show where things are on lab maps, with upload and link checks
- **web:** step into places with Tab while typing in the place picker
- **server:** user/token admin, carry overview, history with undo, setup and backups
- **web:** users, account, history, backups, phone setup, carry reminder, Finnish UI
- **server:** 3D maps from .glb models, objects linked by loc-<code> names
- **web:** 3D lab view with highlighted path, labels and click-through
- **web:** keyboard shortcuts with a ? cheat sheet
- colour fields stored as name + hex, with a palette and custom shades
- **web:** tuck occasional pages under More; starter categories offered once, then in a menu
- **server:** label batches, retired codes, changing and swapping codes
- **web:** manage printed labels and fix wrong or lost ones

### Fixes
- **server:** serve uploaded SVG, HTML and XML files sandboxed
- **server:** serve web files built after startup, 404 for missing assets
- **web:** align the add-person form by moving the password hint below it

### Documentation
- research and plan for ixfwms
- README, contributing guide and MCP inventory workflow
- README and plan status for the web app
- labels guide and status for scanning and labels
- record feedback from the first hands-on test
- what 0.4 contains
- what 0.5 contains
- lab maps guide and status for 0.6
- 3D maps guide and recent changes
- keyboard shortcuts
- colours, sidebar and starter categories
- what to do when labels go wrong
- bring README and guides up to date; release script takes an explicit version

### Maintenance
- npm workspaces monorepo with lint, format, test, hooks and release tooling
- allow subjects that start with names like SQLite or MCP
- Docker image, compose file and Caddy HTTPS config
- share API response types through the domain package and make it browser-safe
- run hooks on tsx and css files too
