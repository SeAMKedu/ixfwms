import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Actor, Services } from '../index.js';
import { tool } from '../../mcp/tool.js';

const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

/** Deleting what was made by mistake. Ask the person first; archive or retire anything real. */
export function registerDeleteTools(server: McpServer, services: Services, actor: Actor): void {
  const done = (what: string) => ({ deleted: what });
  server.registerTool(
    'delete_part',
    {
      title: 'Delete an item',
      description:
        'Delete an item completely: its stock, units, files and history go too. Not while any of it is built into a build or one of its units is lent out (return it, or set its status to lost). To keep it on record, archive it instead (update_part status archived) or merge it. Its code is retired. Ask the person before deleting.',
      inputSchema: { ref: z.string().describe('Item code') },
      annotations: destructive,
    },
    tool(async ({ ref }) => (await services.deletes.part(ref, actor), done(ref))),
  );
  server.registerTool(
    'delete_unit',
    {
      title: 'Delete a unit',
      description:
        'Delete a unit completely, with its log. Not while it is built into a build, or lent out (unless its status is lost). For a unit that is gone for real, set its status to archived instead (it can be set back). Ask the person before deleting.',
      inputSchema: { ref: z.string().describe('Unit code') },
      annotations: destructive,
    },
    tool(async ({ ref }) => (await services.deletes.unit(ref, actor), done(ref))),
  );
  server.registerTool(
    'delete_location',
    {
      title: 'Delete an empty place or build',
      description:
        'Delete a place or build made by mistake. Only when it is empty (no stock, units or places inside) and no unit has it as home. Its code is retired. Ask the person before deleting.',
      inputSchema: { ref: z.string().describe('Place or build code') },
      annotations: destructive,
    },
    tool(async ({ ref }) => (await services.deletes.location(ref, actor), done(ref))),
  );
}
