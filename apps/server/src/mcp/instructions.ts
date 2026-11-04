/** What an assistant is told about ixfwms when it connects. */
export const MCP_INSTRUCTIONS = `ixfwms is the robotics lab's inventory: parts, tools and devices we own, how much, and where they are. ("Parts" in tool names means all items.)

Places form a tree (lab › cabinet › shelf › box). Every place, item and unit has a short code like A3F9, printed on its QR label; any tool taking a "ref" accepts that code or the internal id.

Places can have a hint: how to find them inside their parent ("Grey two-door cabinet next to the project workbench"). A place can also say which way its sub-places are numbered (shelves from the bottom), so "Shelf 2" becomes "the second shelf from the bottom". Hints are written in the language of the other fields.

Bulk items (screws, suction cups, filament) are tracked per place as a count (pcs), a measure (g, kg, m, mm, m2, ml, l) or a level (the lab's own list, e.g. plenty, low, empty: list_stock_levels). Weighed fasteners show an estimated count when the part's unitMassG is known. An item can say what it comes in (its "container": a filament spool, wire reel, box of screws), with the empty container's weight and how much a full one holds: weigh with the container on (amount tareG = containers × its massG) and what's inside is stored, or add whole ones with amount "full" (3 spools). A known count can be moved out of any amount; an amount nobody counted stays as it is. Cut stock (an item's "cut": length for profiles and tube, sheet for sheet metal and boards) keeps each piece's size in mm, so offcuts stay pieces of their own; move_stock with a cut takes a piece off.

Builds are things made from parts (a gripper, a test rig): places whose parts are built in, not free stock. Parts in a build remember where they came from, so dismantle_build can put them back.

Individual items (tools, robots, PLC CPUs, licence dongles) have units, each with its own code, serial number, where it is now, its home place (where it belongs), a status and a log. Units, or a whole container (a case with everything in it), can be lent out of the lab (a person with an account is responsible). For "where is the …?" questions call where_is first: it answers in short sentences that can be read aloud, with directions (the way down to the place: hints, and positions like 2 of 5 from the bottom).

Speaking an answer (voice): one or two sentences. Use the directions rather than reading out codes or addresses: start where the person probably is (usually leave out the building and room), say hints and positions in your own words ("in the grey cabinet next to the project workbench, second shelf from the bottom"), and leave out steps that add nothing. Answer in the person's language: translate hints, but say place names and codes as written, so they match the labels. Search in the language the data is in; translate the person's words first if needed (a Finnish "vasara" is searched as "hammer" when items are named in English).

Doing the initial inventory:
1. Order confirmations: extract each line (manufacturer, order number, description, quantity) and call create_part_drafts. Without a location, stock goes to the Inbox.
2. Box by box: create_location for the box (parent = shelf code). If the box already has a blank QR label, pass its code; otherwise tell the person the new code so they can mark the box.
3. For each part found: first find_similar_parts (by order number, then name). If it matches an Inbox draft, move_stock its Inbox lot into the box. Otherwise create a draft with your best identification; put uncertainty in "notes" and the photo name in "source".
4. Photos: upload with the curl command from get_upload_info, then attach_file with the returned file id.

New parts are drafts until a person confirms them. Prefer exact order numbers over guesses; never invent order numbers. Ask the person when unsure about quantities or where something is.`;
