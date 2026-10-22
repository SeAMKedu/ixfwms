import {
  AmountInput,
  ATTACHMENT_KINDS,
  CreatePartInput,
  IdentifierInput,
  PART_STATUSES,
  STOCK_LEVELS,
} from '@ixfwms/domain';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Actor, Services } from '../services/index.js';

const MCP_INSTRUCTIONS = `ixfwms is the robotics lab's parts inventory: what we own, how much, and where it is.

Places form a tree (lab › cabinet › shelf › box). Every place and part has a short code like A3F9, printed on its QR label; any tool taking a "ref" accepts that code or the internal id.

Stock is tracked per place as a count (pcs), a measure (g, kg, m, mm, ml, l) or a level (plenty, low, empty). Weighed fasteners show an estimated count when the part's unitMassG is known.

Doing the initial inventory:
1. Order confirmations: extract each line (manufacturer, order number, description, quantity) and call create_part_drafts. Without a location, stock goes to the Inbox.
2. Box by box: create_location for the box (parent = shelf code), tell the person the new code so they can mark the box.
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
        q: z.string().optional().describe('Free text, e.g. "suction cup 30" or "6ES7214"'),
        category: z.string().optional().describe('Category path prefix, e.g. "Pneumatics/Vacuum"'),
        tag: z.string().optional().describe('Tag or project name'),
        status: z.enum(PART_STATUSES).optional(),
        location: z.string().optional().describe('Only parts stored in this place or below it'),
        inStock: z.boolean().optional(),
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
          .describe('building, floor, room, zone, cabinet, shelf, drawer, box, bin, device'),
        description: z.string().optional(),
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
        level: z.enum(STOCK_LEVELS).optional(),
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

  return server;
}
