import { AmountInput, MoveAmount } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

/** Stock amounts: adding, taking, counting and moving lots. */
export function stockTools(server: McpServer, { services, actor }: ToolContext): void {
  const { stock } = services;

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
        'Move a lot, or part of it, to another place, e.g. from the Inbox into the box where it was found. Give nothing to move it all; a quantity in its unit; a count of pieces (also from a level or stock nobody counted, which stays as it is); or a cut for bars and sheets (cut stock).',
      inputSchema: {
        lotId: z.string(),
        to: z.string().describe('Place code'),
        ...MoveAmount.shape,
      },
      annotations: write,
    },
    tool(async (a) => stock.move(a.lotId, a.to, a, actor)),
  );
}
