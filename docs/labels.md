# QR labels

Every place and part has a short code (for example `A3F9`). The QR code on its label is a link to it:
`https://<server>/L/A3F9` for places, `/P/K7Q2` for parts. Any phone camera opens that link, and the
app's own scanner (Scan tab) reads it too.

## Before printing for real

Set `IXF_PUBLIC_URL` (see `.env.example`) to the name the lab will use for good, such as
`https://ixf.local` or `https://ixf.internal`. Without it, labels use whatever address the browser
used, which may be an IP address that changes later.

The QR never needs reprinting when things move or get renamed: the code stays the same. Even if the
server's name changes, the in-app scanner ignores the host part, so old labels keep working there.

## Addresses on labels

Fixed places (rooms, cabinets, shelves) have an address made of short names, for example
`Robolab-A-C` for shelf C in cabinet A of the Robolab. The labels the app draws print it instead of
the code: the part above the place small, the place's own short name large (`Robolab-A-` **C**).
Short names are guessed from names ("Cabinet A" → `A`, "Shelf 3" → `3`) and can be set on the place
page, e.g. a room number `A140.1`.

Containers (boxes, bins, drawers, pallets; set in **More › Settings › Place types**) aren't part of addresses, so
carrying them elsewhere never makes a label wrong. Their labels show the code, or a short name if one
is set. Fixed places rarely move; if one does, its address label needs reprinting.

To print labels by code instead, use the CSV and a template with `code`.

The URL is printed in upper case on purpose. That lets the QR use a more compact encoding, so a
typical label link fits a 25×25 QR code, which matters on 9 mm tape.

## Brother P-touch (PT-E560BT)

**Batches, from a PC (recommended):**

1. In ixfwms, download a CSV: **Labels › Labels for a place**, or **Label › CSV: this and everything inside** on a place page. Columns:

   | Column    | Example (a shelf)          | Example (a box)                     |
   | --------- | -------------------------- | ----------------------------------- |
   | `code`    | `BFH8`                     | `52QF`                              |
   | `qr`      | `HTTPS://IXF.LOCAL/L/BFH8` | `HTTPS://IXF.LOCAL/L/52QF`          |
   | `name`    | `Shelf C`                  | `Box: vacuum parts`                 |
   | `path`    | `Robotics lab › Cabinet A` | `Robotics lab › Robot cell 2`       |
   | `type`    | `shelf`                    | `box`                               |
   | `address` | `Robolab-A-C`              | its short name, if set (else empty) |
   | `parent`  | `Robolab-A`                | `Robolab-2` (where it is now)       |
   | `short`   | `C`                        | its short name, if set (else empty) |

2. In P-touch Editor, make one template per tape width (once):
   - **9 mm**: QR code linked to `qr`, plus text linked to `short` (large) and `parent` (small),
     or to `code`.
   - **12 mm**: the same + `name`.
   - **24 mm**: the same + `name` + `path`.

   For boxes, use a template with `code` (or `short`) and `name` instead.

   Use QR error correction M, and keep the QR as large as the tape allows.

3. **File › Database › Connect**, choose the CSV, and print all records (or a selection).

Save the templates in the repository under `labels/ptouch/` so everyone uses the same ones.

**Single labels, from a phone:** on a place or part page, choose the tape width under **Label** and
tap **PNG for phone printing**. Print the PNG with Brother's iPrint&Label / Pro Label Tool app.

**Test print first:** check on 9 mm tape that the QR scans reliably from a phone at arm's length.

## Blank labels

Print a batch of unused codes before an inventory round (**Labels › Blank labels**). Stick them on
boxes as you go. Scanning one that isn't registered yet opens **New place with code …**, which
registers the box with that code. An AI assistant can do the same: `create_location` with `code`.

## When labels go wrong

- **Lost the printout of blank labels:** Labels › _Printed blank labels_ lists every batch with
  how many codes are unused, used and retired. _Download unused again_ gives the CSV for the codes
  still unused.
- **Blank labels lost or damaged:** _Show codes_, tick them, and _Retire_. Retired codes are never
  handed out again, and scanning one shows "retired label".
- **A box has a different sticker than the one registered** (e.g. a blank label stuck on it later):
  on the place page, _Label › Wrong or lost label? › The code on its sticker_. The place takes
  that code, and its old code is retired.
- **Two boxes got each other's labels:** same menu, _Swap codes with_ the other place.
- **The label fell off or is unreadable:** _New code_ gives the place a fresh code to print. The old
  one is retired, so a stray old sticker can't point at the wrong box.

The same works for parts. Every code change is in the history.

## Laser marking

On a place or part page, **Label › DXF for laser** downloads the QR as vector rectangles in
millimetres (1 mm modules by default), inside a card outline with a mounting hole. Laser labels use
error correction Q, which survives scratches better. API: `/api/labels/<code>/qr.dxf?module=0.8&card=1`
and `/api/labels/<code>/qr.svg?size=20` (size in mm).
