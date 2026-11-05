import {
  CreatePartInput,
  PartSearchInput,
  SimilarPartsInput,
  UpdatePartInput,
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
      inputSchema: PartSearchInput.omit({ byUnit: true }).shape,
      annotations: read,
    },
    tool(async (a) => {
      const r = await parts.search(a);
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
      inputSchema: SimilarPartsInput.shape,
      annotations: read,
    },
    tool(async ({ name, identifiers }) => parts.findSimilar(name ?? null, identifiers)),
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
      inputSchema: { ref: z.string().describe('Part code or id'), ...UpdatePartInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...patch }) => {
      await parts.update(ref, patch, actor);
      return withPartLinks(ref);
    }),
  );
}
