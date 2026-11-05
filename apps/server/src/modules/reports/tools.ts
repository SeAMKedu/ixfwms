import { REPORT_KINDS } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

/** Problem reports and resolving them. */
export function reportsTools(server: McpServer, { services, actor }: ToolContext): void {
  const { reports } = services;

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
}
