# Initial inventory with an AI assistant

Until the web UI exists (0.2), the fastest way to fill ixfwms is to let an assistant such as Claude do the typing over MCP. Everything it creates is a **draft** that a person confirms later.

## Setup (once)

1. Create a user and an `inventory` token for the assistant:
   ```bash
   npm run cli -- user:create --name assistant
   npm run cli -- token:create --user assistant --name claude --scopes inventory
   ```
2. Connect Claude Code (use the server's real address):
   ```bash
   claude mcp add --transport http ixfwms http://<server>:3000/mcp --header "Authorization: Bearer ixf_..."
   ```
3. For photo uploads, put the same token in your shell: `export IXF_TOKEN=ixf_...`

## Step 1: order confirmations

Paste or attach recent order confirmations (text, `.eml` or PDF) and ask:

> Add every line of these orders to ixfwms as drafts in the Inbox, with manufacturer, order number and quantity. Check for duplicates first.

The parts land in the **Inbox** location: we know we own them, not yet where they are.

## Step 2: box by box

> I'm at the robotics lab, cabinet A, shelf 3. Create a box "vacuum parts" there.

The assistant replies with the box's code (for example `A3F9`). Write it on the box with a marker. Printed QR labels come later, and the code never changes.

Then photograph what's in the box: one photo per kind of part. Show the bag label or part marking if there is one, and a ruler or caliper reading for unmarked parts. Share the photos with the assistant:

> These are in box A3F9.

For each photo, the assistant:

- matches it against Inbox drafts and moves that stock into the box, or
- checks for similar parts, then creates a new draft with its best identification and a note on how sure it is,
- uploads the photo (`curl` to `/api/files`) and attaches it,
- records the amount: a count, a weight (screws: give the gross weight and box weight) or a level (plenty / low / empty).

## Tips

- Parts with printed order numbers (Festo, SMC, Schmalz, Phoenix Contact, Siemens) are identified reliably. Unmarked screws and fittings get a good description but rarely an exact order number. That's fine: drafts can be completed later.
- For fasteners, give `unitMassG` (mass of one piece). Weighed stock then shows an estimated count.
- Make a backup before a big session: `npm run cli -- backup`.
- Every change is logged with who made it. Drafts can be fixed or merged during review in the web UI (0.2).
