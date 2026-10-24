import {
  AddUnitsInput,
  AmountInput,
  BomLine,
  AttributeFilter,
  ATTACHMENT_KINDS,
  CreatePartInput,
  IdentifierInput,
  LendInput,
  PART_KINDS,
  PART_STATUSES,
  REPORT_KINDS,
  TRACKING_MODES,
  UNIT_LOG_KINDS,
  UpdateUnitInput,
} from '@ixfwms/domain';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Actor, Services } from '../services/index.js';

const MCP_INSTRUCTIONS = `ixfwms is the robotics lab's inventory: parts, tools and devices we own, how much, and where they are. ("Parts" in tool names means all items.)

Places form a tree (lab › cabinet › shelf › box). Every place, item and unit has a short code like A3F9, printed on its QR label; any tool taking a "ref" accepts that code or the internal id.

Bulk items (screws, suction cups, filament) are tracked per place as a count (pcs), a measure (g, kg, m, mm, ml, l) or a level (the lab's own list, e.g. plenty, low, empty: list_stock_levels). Weighed fasteners show an estimated count when the part's unitMassG is known.

Individual items (tools, robots, PLC CPUs, licence dongles) have units, each with its own code, serial number, where it is now, its home place (where it belongs), a status and a log. Units can be lent out of the lab (a person with an account is responsible). For "where is the …?" questions call where_is first: it answers in short sentences that can be read aloud.

Doing the initial inventory:
1. Order confirmations: extract each line (manufacturer, order number, description, quantity) and call create_part_drafts. Without a location, stock goes to the Inbox.
2. Box by box: create_location for the box (parent = shelf code). If the box already has a blank QR label, pass its code; otherwise tell the person the new code so they can mark the box.
3. For each part found: first find_similar_parts (by order number, then name). If it matches an Inbox draft, move_stock its Inbox lot into the box. Otherwise create a draft with your best identification; put uncertainty in "notes" and the photo name in "source".
4. Photos: upload with the curl command from get_upload_info, then attach_file with the returned file id.

New parts are drafts until a person confirms them. Prefer exact order numbers over guesses; never invent order numbers. Ask the person when unsure about quantities or where something is.`;

type Handler<A> = (args: A) => Promise<unknown>;

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] };
}

/** Wraps a tool handler: AppErrors become readable tool errors instead of protocol failures. */
function tool<A>(fn: Handler<A>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      if (err instanceof AppError)
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      if (err instanceof z.ZodError) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${z.prettifyError(err)}` }],
        };
      }
      throw err;
    }
  };
}

const DraftInput = CreatePartInput.omit({ status: true });

/** Builds an MCP server bound to one caller. Stateless: a new instance per HTTP request. */
export function createMcpServer(
  services: Services,
  actor: Actor,
  baseUrl: string,
  version: string,
): McpServer {
  const server = new McpServer({ name: 'ixfwms', version }, { instructions: MCP_INSTRUCTIONS });
  const { parts, locations, locationViews, stock, files } = services;
  const abs = (href: string) => (href.startsWith('/') ? `${baseUrl}${href}` : href);
  const partUrl = (code: string) => `${baseUrl}/p/${code}`;
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  const withPartLinks = async (ref: string) => {
    const p = await parts.get(ref);
    return {
      ...p,
      url: partUrl(p.code),
      attachments: p.attachments.map((a) => ({ ...a, href: abs(a.href) })),
    };
  };

  server.registerTool(
    'search_parts',
    {
      title: 'Search parts',
      description:
        'Search the inventory by text (name, description, manufacturer, order number, code) and filters.',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe(
            'Free text, e.g. "suction cup 30", "6ES7214" or "impact drill" (aliases, unit names and serial numbers match too)',
          ),
        kind: z.enum(PART_KINDS).optional().describe('part, tool or device'),
        category: z.string().optional().describe('Category path prefix, e.g. "Pneumatics/Vacuum"'),
        tag: z.string().optional().describe('Tag or project name'),
        status: z.enum(PART_STATUSES).optional(),
        location: z.string().optional().describe('Only parts stored in this place or below it'),
        inStock: z.boolean().optional(),
        lowStock: z.boolean().optional().describe('Below minimum stock, or marked low/empty'),
        attributes: z
          .array(AttributeFilter)
          .optional()
          .describe(
            'Filters on category fields (see get_category_fields), e.g. {key:"thread",op:"eq",value:"M4"}',
          ),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: read,
    },
    tool(async (a) => {
      const r = await parts.search({ ...a, limit: a.limit ?? 50, offset: a.offset ?? 0 });
      return { total: r.total, items: r.items.map((p) => ({ ...p, url: partUrl(p.code) })) };
    }),
  );

  server.registerTool(
    'get_part',
    {
      title: 'Get part',
      description:
        'Everything about one part: identifiers, where each lot is (full path), files (datasheets, CAD/STEP) and recent history.',
      inputSchema: { ref: z.string().describe('Part code or id') },
      annotations: read,
    },
    tool(async ({ ref }) => withPartLinks(ref)),
  );

  server.registerTool(
    'find_similar_parts',
    {
      title: 'Find similar parts',
      description:
        'Check for existing parts (including Inbox drafts) before creating one. Matches identical order numbers first, then similar names.',
      inputSchema: {
        name: z.string().optional(),
        identifiers: z.array(z.string()).optional().describe('Order numbers / MPNs to match'),
      },
      annotations: read,
    },
    tool(async ({ name, identifiers }) => parts.findSimilar(name ?? null, identifiers ?? [])),
  );

  server.registerTool(
    'list_location_types',
    {
      title: 'List place types',
      description:
        'Place types for create_location. Movable ones (boxes, bins, pallets) are containers that get carried around; the others make up addresses like "Robolab-A-C".',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => locations.types()),
  );

  server.registerTool(
    'list_stock_levels',
    {
      title: 'List stock levels',
      description:
        'The levels this lab uses for stock tracked as a level (best first), with what each means: ok, low (reorder) or empty.',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => stock.levels()),
  );

  server.registerTool(
    'list_overdue_places',
    {
      title: 'Overdue temporary places',
      description:
        'Temporary places (pallets, deliveries…) nobody has touched for longer than expected, with who to ask.',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => locations.overdue()),
  );

  server.registerTool(
    'list_locations',
    {
      title: 'List places',
      description: 'The tree of places (lab › cabinet › shelf › box) with their codes.',
      inputSchema: {
        root: z.string().optional().describe('Start from this place; omit for everything'),
        depth: z.number().int().min(1).max(20).optional(),
      },
      annotations: read,
    },
    tool(async ({ root, depth }) => locations.tree(root ?? null, depth ?? 10)),
  );

  server.registerTool(
    'get_location',
    {
      title: 'Get place',
      description:
        'A place with its path, sub-places and contents. Use recursive to include everything inside sub-places.',
      inputSchema: {
        ref: z.string().describe('Place code or id'),
        recursive: z.boolean().optional(),
      },
      annotations: read,
    },
    tool(async ({ ref, recursive }) => {
      const d = await locationViews.detail(ref, { recursive: recursive ?? false });
      return {
        ...d,
        url: `${baseUrl}/l/${d.code}`,
        attachments: d.attachments.map((a) => ({ ...a, href: abs(a.href) })),
      };
    }),
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description:
        'Existing part categories with part counts. Reuse these paths when creating parts.',
      annotations: read,
    },
    tool(async () => parts.listCategories()),
  );

  server.registerTool(
    'check_availability',
    {
      title: 'Check a parts list',
      description:
        'Can we build this? Matches a parts list (order numbers, part codes or names, with quantities) against stock: what we have, where it is, and what is missing. Also returns how many complete sets can be built.',
      inputSchema: {
        lines: z
          .array(BomLine)
          .min(1)
          .max(500)
          .describe(
            'e.g. [{ref:"SPB1 30 NBR-60 G1/4-IG", quantity:4}, {name:"vacuum generator", quantity:1}]',
          ),
      },
      annotations: read,
    },
    tool(async ({ lines }) => services.bom.check(lines)),
  );

  server.registerTool(
    'get_category_fields',
    {
      title: 'Get category fields',
      description:
        'The fields a category defines for its parts (with inherited ones), e.g. thread and length for screws. Fill them in as part attributes using the field keys.',
      inputSchema: { path: z.string().describe('Category path, e.g. "Fasteners/Screws"') },
      annotations: read,
    },
    tool(async ({ path }) => parts.categoryFields(path)),
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'Existing tags (often project names) with part counts.',
      annotations: read,
    },
    tool(async () => parts.listTags()),
  );

  server.registerTool(
    'get_upload_info',
    {
      title: 'How to upload files',
      description:
        'How to upload a photo, datasheet or CAD file so it can be attached with attach_file.',
      annotations: read,
    },
    tool(() =>
      Promise.resolve({
        uploadUrl: `${baseUrl}/api/files`,
        curl: `curl -sS -H "Authorization: Bearer $IXF_TOKEN" -F "file=@/path/to/photo.jpg" ${baseUrl}/api/files`,
        note: 'The response JSON has an "id"; pass it as fileId to attach_file. Use the same API token as this MCP connection.',
      }),
    ),
  );

  server.registerTool(
    'create_location',
    {
      title: 'Create place',
      description:
        'Create a place (room, cabinet, shelf, box, …) and get its short code for the label.',
      inputSchema: {
        name: z.string().describe('e.g. "Box: vacuum parts" or "Shelf 3"'),
        parent: z.string().optional().describe('Parent place code; omit for a top-level place'),
        type: z
          .string()
          .optional()
          .describe(
            'Place type key: building, floor, room, zone, cabinet, shelf, pallet, drawer, box, bin, device (the lab may have more; list_location_types)',
          ),
        shortName: z
          .string()
          .optional()
          .describe(
            'Short name for the address, e.g. "A" for Cabinet A; omit to guess it from the name',
          ),
        description: z.string().optional(),
        stayDays: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Temporary place (e.g. a delivery pallet): expected stay in days; 0 = not temporary',
          ),
        contact: z.string().optional().describe('Who to ask about a temporary place'),
        code: z
          .string()
          .optional()
          .describe('Code from a pre-printed blank QR label on the box, if it has one'),
      },
      annotations: write,
    },
    tool(async (a) => {
      const loc = await locations.create(
        {
          name: a.name,
          parent: a.parent ?? null,
          type: a.type ?? 'box',
          description: a.description ?? null,
          code: a.code ?? null,
          shortName: a.shortName ?? null,
          stayDays: a.stayDays,
          contact: a.contact ?? null,
        },
        actor,
      );
      return { ...loc, url: `${baseUrl}/l/${loc.code}` };
    }),
  );

  server.registerTool(
    'create_part_drafts',
    {
      title: 'Create part drafts',
      description:
        'Create one or more parts as drafts for human review, optionally with initial stock (defaults to the Inbox). Call find_similar_parts first to avoid duplicates.',
      inputSchema: { parts: z.array(DraftInput).min(1).max(50) },
      annotations: write,
    },
    tool(async (a) => {
      const results = await parts.createMany(
        a.parts.map((p) => CreatePartInput.parse({ ...p, status: 'draft' })),
        actor,
      );
      return results.map((r) =>
        r.ok
          ? {
              ok: true,
              code: r.value.code,
              name: r.value.name,
              url: partUrl(r.value.code),
              lots: r.value.lots.map((l) => ({
                lotId: l.id,
                display: l.display,
                location: l.location.code,
              })),
            }
          : r,
      );
    }),
  );

  server.registerTool(
    'update_part',
    {
      title: 'Update part',
      description: 'Change fields of a part, add identifiers or tags. Attributes are merged.',
      inputSchema: {
        ref: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        manufacturer: z.string().optional(),
        kind: z.enum(PART_KINDS).optional(),
        tracking: z
          .enum(TRACKING_MODES)
          .optional()
          .describe(
            'individual = units with codes and serials; only while it has no stock amounts',
          ),
        aliases: z.array(z.string()).optional().describe('Replaces the other names people use'),
        unitMassG: z.number().positive().optional(),
        minStock: z.number().nonnegative().optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        source: z.string().optional(),
        addIdentifiers: z.array(IdentifierInput).optional(),
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
      },
      annotations: write,
    },
    tool(async ({ ref, ...patch }) => {
      await parts.update(ref, patch, actor);
      return withPartLinks(ref);
    }),
  );

  server.registerTool(
    'add_stock',
    {
      title: 'Add stock',
      description:
        'Record that some of a part is in a place. Merges with existing stock of the same part there.',
      inputSchema: {
        part: z.string().describe('Part code or id'),
        location: z.string().optional().describe('Place code; omit for the Inbox'),
        amount: AmountInput,
        note: z.string().optional(),
      },
      annotations: write,
    },
    tool(async (a) =>
      stock.add(
        { part: a.part, location: a.location ?? null, amount: a.amount, note: a.note ?? null },
        actor,
      ),
    ),
  );

  server.registerTool(
    'take_stock',
    {
      title: 'Take stock',
      description:
        'Record that some was taken from a lot (or set the new level for level-tracked stock).',
      inputSchema: {
        lotId: z.string(),
        quantity: z.number().positive().optional(),
        level: z.string().optional().describe('New level, key or name (list_stock_levels)'),
      },
      annotations: write,
    },
    tool(async (a) => stock.take(a.lotId, a.quantity ?? null, a.level ?? null, actor)),
  );

  server.registerTool(
    'set_stock_amount',
    {
      title: 'Set counted amount',
      description: 'Set the amount of a lot after counting or weighing it (stocktake).',
      inputSchema: { lotId: z.string(), amount: AmountInput },
      annotations: write,
    },
    tool(async (a) => stock.stocktake(a.lotId, a.amount, actor)),
  );

  server.registerTool(
    'move_stock',
    {
      title: 'Move stock',
      description:
        'Move a lot, or part of it, to another place, e.g. from the Inbox into the box where it was found.',
      inputSchema: {
        lotId: z.string(),
        to: z.string().describe('Destination place code'),
        quantity: z.number().positive().optional().describe('Omit to move the whole lot'),
      },
      annotations: write,
    },
    tool(async (a) => stock.move(a.lotId, a.to, a.quantity ?? null, actor)),
  );

  server.registerTool(
    'move_location',
    {
      title: 'Move place',
      description: 'Move a place (box, shelf, …) with everything inside it under another place.',
      inputSchema: {
        ref: z.string(),
        parent: z.string().nullable().describe('New parent code, or null for top level'),
      },
      annotations: write,
    },
    tool(async (a) => locations.move(a.ref, a.parent, actor)),
  );

  server.registerTool(
    'duplicate_location',
    {
      title: 'Copy place',
      description:
        'Copy a place with all places inside it (not stock), each copy with a new code, e.g. six more cabinets like this one. Copies are named on (Cabinet A → Cabinet B) unless a name is given, and share its maps.',
      inputSchema: {
        ref: z.string(),
        count: z.number().int().min(1).max(20).optional(),
        name: z.string().optional().describe('Name of the first copy'),
        parent: z
          .string()
          .nullable()
          .optional()
          .describe('Where to put the copies; default next to the original'),
      },
      annotations: write,
    },
    tool(async (a) =>
      locations.duplicate(
        a.ref,
        { count: a.count, name: a.name, parent: a.parent },
        actor,
        (tx, pairs) => services.maps.copyMapsFor(tx, pairs),
      ),
    ),
  );

  server.registerTool(
    'attach_file',
    {
      title: 'Attach file or link',
      description:
        'Attach an uploaded file (by id) or a URL (product page, datasheet, CAD download) to a part or place.',
      inputSchema: {
        owner: z.enum(['part', 'location']),
        ref: z.string(),
        kind: z.enum(ATTACHMENT_KINDS),
        fileId: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
      },
      annotations: write,
    },
    tool(async (a) => {
      const view = await files.attach(
        {
          owner: a.owner,
          ref: a.ref,
          kind: a.kind,
          fileId: a.fileId ?? null,
          url: a.url ?? null,
          title: a.title ?? null,
        },
        actor,
      );
      return { ...view, href: abs(view.href) };
    }),
  );

  const { units, reports, where } = services;
  const unitUrl = (code: string) => `${baseUrl}/u/${code}`;
  const withUnitLink = <T extends { code: string }>(u: T) => ({ ...u, url: unitUrl(u.code) });

  server.registerTool(
    'where_is',
    {
      title: 'Where is it?',
      description:
        'Answers "where is the impact drill?" in short sentences, one per thing found: where it is, where it belongs, who has it, whether it is broken. Made to be read aloud.',
      inputSchema: { query: z.string().describe('What to look for, e.g. "impact drill"') },
      annotations: read,
    },
    tool(async ({ query }) => {
      const answers = await where.ask(query);
      return answers.length ? answers : [{ text: `Nothing found for "${query}".` }];
    }),
  );

  server.registerTool(
    'get_unit',
    {
      title: 'Get unit',
      description:
        'Everything about one unit: where it is and belongs, status, serial number, network details, firmware version, loans, open problem reports and its log.',
      inputSchema: { ref: z.string().describe('Unit code or id') },
      annotations: read,
    },
    tool(async ({ ref }) => withUnitLink(await units.detail(ref, actor))),
  );

  server.registerTool(
    'add_units',
    {
      title: 'Add units',
      description:
        'Register individual things (a drill, a robot, a PLC CPU) of an item. An item without stock amounts becomes individually tracked. Give the home place so "put back" knows where they belong.',
      inputSchema: AddUnitsInput.shape,
      annotations: write,
    },
    tool(async (a) => (await units.add(a, actor)).map(withUnitLink)),
  );

  server.registerTool(
    'update_unit',
    {
      title: 'Update unit',
      description:
        'Change a unit: name, serial number, status, home place, network details, notes or next check date.',
      inputSchema: { ref: z.string(), ...UpdateUnitInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...patch }) => withUnitLink(await units.update(ref, patch, actor))),
  );

  server.registerTool(
    'move_unit',
    {
      title: 'Move unit',
      description:
        'Record that a unit is now somewhere else in the lab (to lend it out, use lend_unit).',
      inputSchema: { ref: z.string(), to: z.string().describe('Destination place code') },
      annotations: write,
    },
    tool(async ({ ref, to }) => withUnitLink(await services.open.moveUnit(ref, to, null, actor))),
  );

  server.registerTool(
    'put_back',
    {
      title: 'Put a unit back',
      description: 'Move a unit back to its home place.',
      inputSchema: { ref: z.string() },
      annotations: write,
    },
    tool(async ({ ref }) => withUnitLink(await services.open.putBackUnit(ref, null, actor))),
  );

  server.registerTool(
    'lend_unit',
    {
      title: 'Lend a unit out of the lab',
      description:
        'A unit leaves the lab (a thesis, a fair, repair at the vendor). Someone with an account is responsible; describe what for and where. Student names only as free text in the description.',
      inputSchema: { ref: z.string(), ...LendInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...loan }) => withUnitLink(await units.lend(ref, loan, actor))),
  );

  server.registerTool(
    'return_unit',
    {
      title: 'Return a lent unit',
      description: 'A lent unit is back: it goes to its home place unless "to" is given.',
      inputSchema: { ref: z.string(), to: z.string().optional() },
      annotations: write,
    },
    tool(async ({ ref, to }) => withUnitLink(await units.returnUnit(ref, to ?? null, actor))),
  );

  server.registerTool(
    'list_loans',
    {
      title: 'List loans',
      description:
        'Units lent out of the lab (open loans, or the latest returned ones), overdue first.',
      inputSchema: { open: z.boolean().optional().describe('Default true') },
      annotations: read,
    },
    tool(async ({ open }) => units.loanList(open ?? true)),
  );

  server.registerTool(
    'log_unit_event',
    {
      title: "Write in a unit's log",
      description:
        'Note, maintenance, firmware (value = version now installed), problem or repaired. Maintenance can set the next check date; problem and repaired change the status.',
      inputSchema: {
        ref: z.string(),
        kind: z.enum(UNIT_LOG_KINDS),
        text: z.string().optional(),
        value: z.string().optional(),
        nextCheckAt: z.string().optional().describe('YYYY-MM-DD'),
      },
      annotations: write,
    },
    tool(async ({ ref, ...entry }) => withUnitLink(await units.log(ref, entry, actor))),
  );

  server.registerTool(
    'list_units_needing_attention',
    {
      title: 'Units needing attention',
      description: 'Units that are reported, broken or in repair, or due for a maintenance check.',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => units.attention()),
  );

  server.registerTool(
    'report_problem',
    {
      title: 'Report a problem',
      description:
        'Report that a unit, item or place is broken, missing parts, running low, or something else. Stays in the Inbox until resolved.',
      inputSchema: {
        owner: z.enum(['unit', 'part', 'location']),
        ref: z.string(),
        kind: z.enum(REPORT_KINDS),
        note: z.string().optional(),
      },
      annotations: write,
    },
    tool(async (a) => reports.create(a, actor)),
  );

  server.registerTool(
    'list_reports',
    {
      title: 'List problem reports',
      description: 'Open problem reports (or the latest resolved ones).',
      inputSchema: { open: z.boolean().optional().describe('Default true') },
      annotations: read,
    },
    tool(async ({ open }) => reports.list(open ?? true)),
  );

  server.registerTool(
    'resolve_report',
    {
      title: 'Resolve a problem report',
      description:
        'Mark a report done, saying what was done. A unit with no open reports left is OK again.',
      inputSchema: { id: z.string(), resolution: z.string().optional() },
      annotations: write,
    },
    tool(async ({ id, resolution }) => reports.resolve(id, resolution ?? null, actor)),
  );

  return server;
}
