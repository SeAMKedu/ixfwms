import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, type ToolContext } from '../../mcp/tool.js';

/** Categories and the fields they define for their parts. */
export function categoriesTools(server: McpServer, { services }: ToolContext): void {
  const { categories } = services;

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description:
        'Existing part categories with part counts (parts counts everything below a category, ownParts only its own). Reuse these paths when creating parts.',
      annotations: read,
    },
    tool(async () => categories.list()),
  );

  server.registerTool(
    'get_category_fields',
    {
      title: 'Get category fields',
      description:
        'The fields a category defines for its parts (with inherited ones), e.g. thread and length for screws. Fill them in as part attributes using the field keys.',
      inputSchema: { path: z.string().describe('Category path, e.g. "Fasteners/Screws"') },
      annotations: read,
    },
    tool(async ({ path }) => categories.fields(path)),
  );
}
