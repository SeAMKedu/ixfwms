import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Actor, Services } from '../services/index.js';
import { tool, write } from './tool.js';

/** Builds: making one from a parts list and taking it apart. Finding them is search_parts. */
export function registerBuildTools(
  server: McpServer,
  services: Services,
  actor: Actor,
  baseUrl: string,
): void {
  const withLink = <T extends { build: { code: string } }>(r: T) => ({
    ...r,
    url: `${baseUrl}/l/${r.build.code}`,
  });

  server.registerTool(
    'make_build',
    {
      title: 'Make a build',
      description:
        'Make a build (a thing made from parts: a gripper, a test rig) and move the listed parts into it from free stock. Counted stock moves by count, weighed stock by count × piece mass, units one by one. Returns what moved and what is left to do by hand (unknown part, not enough free stock, or stock tracked as a level or not counted). Parts in a build remember where they came from. Use check_availability first to match a parts list to part codes.',
      inputSchema: {
        name: z.string().describe('e.g. "Gripper v3"'),
        parent: z.string().optional().describe('Where the build sits (place code)'),
        contact: z.string().optional().describe('Who to ask about it'),
        description: z.string().optional(),
        lines: z
          .array(z.object({ part: z.string(), quantity: z.number().int().positive() }))
          .max(1000)
          .describe('Part codes and how many of each go in'),
      },
      annotations: write,
    },
    tool(async (a) => withLink(await services.builds.make(a, actor))),
  );

  server.registerTool(
    'dismantle_build',
    {
      title: 'Dismantle a build',
      description:
        'Take a build apart. Without `to`, everything goes back where it came from (stock to its origin, units home); what has no known place stays and is listed. With `to` (a workstation, say), everything is put there to sort first, keeping where it belongs. When nothing is left in the build it is marked dismantled; its code keeps working and its page lists what was in it.',
      inputSchema: {
        ref: z.string().describe('Build code'),
        to: z.string().optional().describe('Put everything on this place instead'),
      },
      annotations: write,
    },
    tool(async ({ ref, to }) => services.builds.dismantle(ref, { to: to ?? null }, actor)),
  );
}
