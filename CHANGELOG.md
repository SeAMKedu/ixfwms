# Changelog

All notable changes to ixfwms.
## 0.17.0 (2026-11-03)

### Features
- place hints and numbering for spoken directions

### Fixes
- count places by short name for directions, so drawers can be named after their contents

### Documentation
- keep internal planning notes out of the repo
- directions to places, hints and numbering

### Maintenance
- check that the docs keep up with the code
- release notes say what upgrading takes

### Upgrading
- Database migrations 0025_place_hints: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.16.0 (2026-10-30)

### Features
- pick the loan's responsible person, hide loan reasons from guests
- filter search by place, and give each user a home place
- purchase details on tools and devices, and a write-off list
- depreciation list shows everything with purchase details, add useful life
- own API tokens and settings on the account page, admins edit them per user
- search filters as pills and search fields, address roots, one-line results

### Documentation
- draw the data model from the schema

### Upgrading
- Database migrations 0020_user_home_place, 0021_unit_purchase, 0022_unit_useful_life, 0023_user_language, 0024_address_root: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.15.0 (2026-10-29)

### Features
- delete items and units unless they're in use
- archive items, units and old containers, and bring them back
- lend a whole container out of the lab, and get it back
- **web:** show what kind each item is in the item list

### Fixes
- **web:** keep add stock and report a problem out of the where box

### Documentation
- notes for Claude on splitting files and the KUKA fleet plan

### Upgrading
- Database migrations 0018_archive, 0019_container_loans: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.14.0 (2026-10-25)

### Features
- builds, things made from parts
- **web:** build pages, builds in search, make a build from a parts list
- builds page, builds among items, add existing items into builds
- counts out of uncounted amounts, cut stock for bars and sheets, m²
- **web:** piece counts, cuts and cut stock in the app
- delete items, units, places and builds made by mistake
- lost units, and Found it when one turns up

### Fixes
- **web:** build's add fields on one row

### Documentation
- plan builds, things made from parts

### Upgrading
- Database migrations 0016_builds, 0017_cut_stock: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.13.0 (2026-10-24)

### Features
- leave people's names out for readers without a login
- erase a person's data, keeping their history as "Removed user"

### Maintenance
- keep namesHidden private
- license copyright to SEAMK
## 0.12.0 (2026-10-24)

### Features
- stock nobody has counted yet

### Fixes
- undo keeps origin, lot races merge, search pages by unit rows

### Upgrading
- Database migrations 0015_whole_counts_and_search_text: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.11.1 (2026-10-24)

### Features
- search lists tools by their units; drop the order no. column

### Maintenance
- cap file and function size in lint; trim bundled fonts
## 0.11.0 (2026-10-24)

### Features
- rename, move and delete categories, with counts that include sub-categories
- units count in place and stock filters, and show in the history
- stock remembers where it belongs; one lot per place and origin; whole-number counts
- error messages in the user's language

### Fixes
- **server:** status change and project tagging each run in one transaction
- **web:** settings get more width, and pages no longer shift sideways

### Documentation
- plan notes after 0.10; stop promising a Postgres switch
- backlog note on limiting what anonymous readers see

### Maintenance
- **server:** keep the Postgres option; SQLite-only SQL moves to db/dialect.ts
- browser tests for search-take, scan-carry-put down and clearing a bench

### Upgrading
- Database migrations 0014_lot_origin: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.10.0 (2026-10-24)

### Features
- **server:** one codes table, with the namespace enforced by triggers

### Fixes
- retire a merged part's code and send scans of it to the part kept

### Documentation
- merged labels forward, one code namespace
- plan status for 0.10

### Maintenance
- **web:** split the part page into section files
- **web:** split the place page into section files
- **web:** split the unit page into section files
- **web:** one file per settings section

### Upgrading
- Database migrations 0012_merged_code_forward, 0013_codes_namespace: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
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

### Upgrading
- Database migrations 0011_user_disabled: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
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

### Upgrading
- Database migrations 0010_items_and_units: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
## 0.7.0 (2026-10-23)

### Features
- shared lab maps linked in the app, and copying places
- readable place addresses and editable place types
- compact maps, settings sections, temporary places, import samples

### Documentation
- drop note about older label templates
- plan status for 0.7, adapters move to 0.8

### Upgrading
- Database migrations 0006_shared_maps, 0007_drop_location_views, 0008_place_addresses, 0009_settings_and_temporary_places: applied when the server starts, after a backup. Going back to an older version means restoring that backup.
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
