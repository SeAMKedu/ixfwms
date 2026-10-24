# Tools, devices and other things tracked one by one

Most of the inventory is stock: "14 suction cups on shelf 3". Some things need to be known individually: _this_ drill (serial number SN-12346) lives on shelf 3, and Matti has it on Workbench 2 right now. Those are **units**.

## Items, kinds and tracking

Everything in the inventory is an **item**. Each item has:

- a **kind**: part, tool or device/machine. This is only a filter in lists and search.
- **tracking**: _as amounts_ (stock lots, as before) or _one by one_ (units). Tools and devices are usually one by one, but kind and tracking are separate on purpose: a box of 50 screwdrivers is a tool tracked as an amount, and a PLC CPU is a part tracked one by one.
- **other names** ("impact driver, iskuporakone"). People, and speech-to-text, often use a different word than the item's name. Search finds these names too.

An item can switch between the two kinds of tracking while it has neither stock nor units.

## Units

Add units on the item page (**Add units**): one per line as `name; serial number`, or just a number for that many. Give their **home place**, where they belong. Each unit gets its own code and QR label (`/U/<code>`).

A unit's label shows its name and its **home address** (e.g. `Robolab-A-3`), so whoever finds it lying around knows where it goes; the code is in the QR. On 9 mm tape both are printed in two small lines; 24 mm adds the item, serial number and code. Without a home place, the code takes the address's place. P-touch Editor templates get the home address in the CSV's `address` column.

A unit page shows:

- **Where:** where it is now and where it belongs. **Put back** sends it home in one tap. **Move**, **Carry** (scan, carry, scan works for units too) and **Lend out of the lab**.
- **Problems:** open problem reports. Anyone can report one.
- **Details:** status (OK, needs attention, broken, in repair, retired), serial number, firmware version, next check date, network details and notes.
- **Log:** every move, loan and status change, plus notes, maintenance and firmware entries written by hand.

### Firmware and software versions

Write a **firmware** entry in the log whenever a version changes ("V4.6, updated with TIA Portal V19"). The details show the latest one _with its date_, so a version nobody has checked for a year shows as an old date rather than as a fact that looks current.

### Maintenance and inspections

A **maintenance** log entry can set the **next check** date (also editable under Details). When that date comes, the unit is listed in the Inbox under _Units needing attention_.

### Network details

IP address, host name and MAC address are shown only to people who are logged in. **More › Network list** gathers them from all units (with a CSV download), so there is no separate list to keep up to date. Never store passwords or other credentials in ixfwms.

## Lending out of the lab

Moving a drill to the next bench is just a move; nobody "checks it out". Taking something **out of the lab** (a camera for thesis tests at a company, a robot to a fair, a device back to the vendor for repair) is a **loan**:

- a **person responsible** with an account, for example the teacher supervising the thesis,
- a **description**: what for and where. Students' names go here as free text; ixfwms keeps no student records.
- an optional **expected back** date.

The unit moves to the built-in place _Out of the lab_. The Inbox lists everything lent out, overdue loans first and in red. **Back from loan** puts the unit back home (or wherever you say).

## Workstations

A place type can be marked **Workstation** (Settings › Place types); _Workstation / table_ is one already. Put a QR code on the table's corner. People bring tools and parts there to work on something.

- Workstations are temporary places with an expected stay of a day, so things left on a bench show in the Inbox the next day.
- **Clear the bench** (on the workstation's page) sends units home and stock back where it came from, looking past "being carried" to where it was picked up. Anything without a known place stays and is listed.

## People without an account

Anyone on the lab network can look things up and **report a problem** with a unit, an item or a place: broken, missing parts, running low, something else. A name is optional; it is remembered on that phone and shown in the history as "Pekka (no account)".

**Settings › Without an account** decides what else they may do:

| Setting                                       | Allows                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Look and report problems                      | nothing moves without logging in                                                  |
| … and put things back                         | units back to their home places, stock back where it came from                    |
| … and bring things to a workstation (default) | also move units and stock (all or some) to a workstation, and clear a workstation |

Never without an account: lending, pallets, editing or deleting.

## Asking an assistant

With the MCP connection (see the README), `where_is` answers "where is the impact drill?" with one short sentence per unit, e.g. _"Drill 2: now at Robolab-WB2; it belongs at Robolab-A-3."_ A voice client (for example Home Assistant Assist with its MCP client) can read these out as they are. Other tools: `get_unit`, `add_units`, `update_unit`, `move_unit`, `put_back`, `lend_unit`, `return_unit`, `list_loans`, `log_unit_event`, `report_problem`, `list_reports`, `resolve_report`, `list_units_needing_attention`.
