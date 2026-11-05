import { LendInput, ReturnPlaceInput } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

/** Lending units and whole containers out of the lab. */
export function loansTools(server: McpServer, { services, actor, links }: ToolContext): void {
  const { loans } = services;
  const withUnitLink = <T extends { code: string }>(u: T) => ({ ...u, url: links.unit(u.code) });

  server.registerTool(
    'lend_unit',
    {
      title: 'Lend a unit out of the lab',
      description:
        'A unit leaves the lab (a thesis, a fair, repair at the vendor). Someone with an account is responsible; describe what for and where. Student names only as free text in the description. A whole case with everything in it: lend_place.',
      inputSchema: { ref: z.string(), ...LendInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...loan }) => withUnitLink(await loans.lendUnit(ref, loan, actor))),
  );

  server.registerTool(
    'return_unit',
    {
      title: 'Return a lent unit',
      description: 'A lent unit is back: it goes to its home place unless "to" is given.',
      inputSchema: { ref: z.string(), to: z.string().optional() },
      annotations: write,
    },
    tool(async ({ ref, to }) => withUnitLink(await loans.returnUnit(ref, to ?? null, actor))),
  );

  server.registerTool(
    'lend_place',
    {
      title: 'Lend a container out of the lab',
      description:
        'A container (a box, case or pallet) leaves the lab with everything in it, e.g. a drone case with its controller, charger and batteries. Same as lend_unit otherwise. Nothing can be taken out of it or put in it until it is returned.',
      inputSchema: { ref: z.string().describe('Place code'), ...LendInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...loan }) => loans.lendPlace(ref, loan, actor)),
  );

  server.registerTool(
    'return_place',
    {
      title: 'Return a lent container',
      description:
        'A lent container is back: it goes where it was before unless "to" is given. Ask which units inside did not come back and list them in "missing"; they are marked lost. Check get_location for what is inside.',
      inputSchema: { ref: z.string().describe('Place code'), ...ReturnPlaceInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...back }) => loans.returnPlace(ref, back, actor)),
  );

  server.registerTool(
    'list_loans',
    {
      title: 'List loans',
      description:
        'Units and containers lent out of the lab (open loans, or the latest returned ones), overdue first.',
      inputSchema: { open: z.boolean().optional().describe('Default true') },
      annotations: read,
    },
    tool(async ({ open }) => loans.list(open ?? true)),
  );
}
