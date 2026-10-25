import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Actor, Services } from '../services/index.js';
import { tool, write } from './tool.js';

/** Lost units: marked lost with update_unit (status lost); this is for when one turns up. */
export function registerLostTools(server: McpServer, services: Services, actor: Actor): void {
  server.registerTool(
    'found_unit',
    {
      title: 'A lost unit was found',
      description:
        'A unit marked lost (update_unit status "lost") turned up: it is OK again, at `to` or back at its home place, and its log says it was found.',
      inputSchema: {
        ref: z.string().describe('Unit code'),
        to: z.string().optional().describe('Where it was found; default its home place'),
      },
      annotations: write,
    },
    tool(async ({ ref, to }) => services.open.foundUnit(ref, to ?? null, null, actor)),
  );
}
