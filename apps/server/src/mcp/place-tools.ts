import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AddressRootSchema } from '@ixfwms/domain';
import { z } from 'zod';
import type { Actor, Services } from '../services/index.js';
import { read, tool, write } from './tool.js';

/**
 * Places: the tree, its types, making, moving and copying places, and archiving old containers.
 * Items are archived with update_part (status archived), units with update_unit (status
 * archived); setting the status back brings them back.
 */
export function registerPlaceTools(
  server: McpServer,
  services: Services,
  actor: Actor,
  baseUrl: string,
): void {
  const { locations, locationViews } = services;
  const abs = (href: string) => (href.startsWith('/') ? `${baseUrl}${href}` : href);

  server.registerTool(
    'list_location_types',
    {
      title: 'List place types',
      description:
        'Place types for create_location. Movable ones (boxes, bins, pallets) are containers that get carried around; the others make up addresses like "Robolab-A-C".',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => services.placeTypes.types()),
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
        addressRoot: AddressRootSchema,
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
          addressRoot: a.addressRoot,
          stayDays: a.stayDays,
          contact: a.contact ?? null,
        },
        actor,
      );
      return { ...loc, url: `${baseUrl}/l/${loc.code}` };
    }),
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
    'archive_location',
    {
      title: 'Archive an old container',
      description:
        'Put an old container (box, bin, pallet: a movable place type) away: hidden from place lists, nothing can go in it, its code still scans. Only when it is empty and no unit has it as home. Rooms and shelves are deleted or kept; builds are dismantled. unarchive_location brings it back.',
      inputSchema: { ref: z.string().describe('Container code') },
      annotations: write,
    },
    tool(async ({ ref }) => services.archives.place(ref, actor)),
  );
  server.registerTool(
    'unarchive_location',
    {
      title: 'Bring back an archived container',
      description: 'An archived container is in use again: listed, and things can go in it.',
      inputSchema: { ref: z.string().describe('Container code') },
      annotations: write,
    },
    tool(async ({ ref }) => services.archives.unarchivePlace(ref, actor)),
  );
}
