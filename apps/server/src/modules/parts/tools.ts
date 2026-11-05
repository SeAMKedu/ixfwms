import {
  ContainerInput,
  AttributeFilter,
  CreatePartInput,
  IdentifierInput,
  PART_KINDS,
  SEARCH_KINDS,
  PART_STATUSES,
  TRACKING_MODES,
} from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

const DraftInput = CreatePartInput.omit({ status: true });

/** Parts: searching, reading, drafting and changing them. */
export function partsTools(server: McpServer, { services, actor, links }: ToolContext): void {
  const { parts } = services;
  const withPartLinks = async (ref: string) => {
    const p = await parts.get(ref);
    return {
      ...p,
      url: links.part(p.code),
      attachments: p.attachments.map((a) => ({ ...a, href: links.abs(a.href) })),
    };
  };

  server.registerTool(
    'search_parts',
    {
      title: 'Search parts',
      description:
        'Search the inventory by text (name, description, manufacturer, order number, code) and filters. Each result is one thing to open: a bulk item, or one unit of a tool or device (only the units the text names, if it names any). `limit`, `offset` and `total` count results; `items` are their parts. `builds` are builds (things made from parts) the text matches, on the first page and without item filters; kind "build" lists the builds still standing. Stock in a build has `place.inBuild` set: it is built in, not free.',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe(
            'Free text, e.g. "suction cup 30", "6ES7214" or "impact drill" (aliases, unit names and serial numbers match too)',
          ),
        kind: z.enum(SEARCH_KINDS).optional().describe('part, tool, device, or build'),
        category: z.string().optional().describe('Category path prefix, e.g. "Pneumatics/Vacuum"'),
        tags: z.array(z.string()).optional().describe('Tag or project names, all of them'),
        status: z.enum(PART_STATUSES).optional(),
        location: z.string().optional().describe('Only parts stored in this place or below it'),
        inStock: z.boolean().optional(),
        lowStock: z.boolean().optional().describe('Below minimum stock, or marked low/empty'),
        uncounted: z.boolean().optional().describe('Has stock nobody has counted yet'),
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
      const byId = new Map(r.items.map((p) => [p.id, p]));
      const buildCode = new Map(r.builds.map((b) => [b.id, b.code]));
      const results = r.rows.map((row) => {
        // A build's link is in `builds`.
        if ('buildId' in row) return { build: buildCode.get(row.buildId)! };
        const p = byId.get(row.partId)!;
        const unit = p.units.find((u) => u.id === row.unitId)?.code ?? null;
        return { part: p.code, unit, url: unit ? links.unit(unit) : links.part(p.code) };
      });
      return {
        total: r.total,
        results,
        items: r.items.map((p) => ({ ...p, url: links.part(p.code) })),
        builds: r.builds.map((b) => ({ ...b, url: links.place(b.code) })),
      };
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
    'list_tags',
    {
      title: 'List tags',
      description: 'Existing tags (often project names) with part counts.',
      annotations: read,
    },
    tool(async () => parts.listTags()),
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
              url: links.part(r.value.code),
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
        container: ContainerInput.nullable().optional(),
        minStock: CreatePartInput.shape.minStock,
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
}
