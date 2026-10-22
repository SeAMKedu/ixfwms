# QR labels

Every place and part has a short code (for example `A3F9`). The QR code on its label is a link to it:
`https://<server>/L/A3F9` for places, `/P/K7Q2` for parts. Any phone camera opens that link, and the
app's own scanner (Scan tab) reads it too.

## Before printing for real

Set `IXF_PUBLIC_URL` (see `.env.example`) to the name the lab will use for good, such as
`https://ixf.local` or `https://ixf.internal`. Without it, labels use whatever address the browser
used, which may be an IP address that changes later.

Labels never need reprinting when things move or get renamed: the code stays the same. Even if the
server's name changes, the in-app scanner ignores the host part, so old labels keep working there.

The URL is printed in upper case on purpose. That lets the QR use a more compact encoding, so a
typical label link fits a 25×25 QR code, which matters on 9 mm tape.

## Brother P-touch (PT-E560BT)

**Batches, from a PC (recommended):**

1. In ixfwms, download a CSV: **Labels › Labels for a place**, or **Label › CSV: this and everything inside** on a place page. Columns: `code`, `qr`, `name`, `path`, `type`.
2. In P-touch Editor, make one template per tape width (once):
   - **9 mm**: QR code linked to `qr`, plus text linked to `code`.
   - **12 mm**: QR + `code` + `name`.
   - **24 mm**: QR + `code` + `name` + `path`.

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

## Laser marking

On a place or part page, **Label › DXF for laser** downloads the QR as vector rectangles in
millimetres (1 mm modules by default), inside a card outline with a mounting hole. Laser labels use
error correction Q, which survives scratches better. API: `/api/labels/<code>/qr.dxf?module=0.8&card=1`
and `/api/labels/<code>/qr.svg?size=20` (size in mm).
