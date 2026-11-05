import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, type ToolContext } from '../../mcp/tool.js';

/** "Where is it?", answered to be read aloud. */
export function whereTools(server: McpServer, { services }: ToolContext): void {
  const { where } = services;

  server.registerTool(
    'where_is',
    {
      title: 'Where is it?',
      description:
        'Answers "where is the impact drill?" in short sentences, one per thing found: where it is, where it belongs, who has it, whether it is broken. Made to be read aloud. `directions` is the way down to the first place named, from the top: each step\'s hint for finding it in the one before, and its position when its parent numbers its sub-places.',
      inputSchema: { query: z.string().describe('What to look for, e.g. "impact drill"') },
      annotations: read,
    },
    tool(async ({ query }) => {
      const answers = await where.ask(query);
      return answers.length ? answers : [{ text: `Nothing found for "${query}".` }];
    }),
  );
}
