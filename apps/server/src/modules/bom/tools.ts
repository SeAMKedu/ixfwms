import { BomLine } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, type ToolContext } from '../../mcp/tool.js';

/** Checking a parts list against stock. */
export function bomTools(server: McpServer, { services }: ToolContext): void {
  server.registerTool(
    'check_availability',
    {
      title: 'Check a parts list',
      description:
        'Can we build this? Matches a parts list (order numbers, part codes or names, with quantities) against stock: what we have, where it is, and what is missing. Also returns how many complete sets can be built. Only free stock counts as available; `salvageable` is what is built into builds (where entries with `build` set) and could be had by dismantling them.',
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
}
