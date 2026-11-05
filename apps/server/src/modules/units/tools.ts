import { AddUnitsInput, UNIT_LOG_KINDS, UpdateUnitInput } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

/** Units: individual things with codes, their status, log and moves. */
export function unitsTools(server: McpServer, { services, actor, links }: ToolContext): void {
  const { units } = services;
  const withUnitLink = <T extends { code: string }>(u: T) => ({ ...u, url: links.unit(u.code) });

  server.registerTool(
    'get_unit',
    {
      title: 'Get unit',
      description:
        'Everything about one unit: where it is and belongs, status, serial number, network details, firmware version, loans, open problem reports and its log.',
      inputSchema: { ref: z.string().describe('Unit code or id') },
      annotations: read,
    },
    tool(async ({ ref }) => withUnitLink(await units.detail(ref, actor))),
  );

  server.registerTool(
    'add_units',
    {
      title: 'Add units',
      description:
        'Register individual things (a drill, a robot, a PLC CPU) of an item. An item without stock amounts becomes individually tracked. Give the home place so "put back" knows where they belong.',
      inputSchema: AddUnitsInput.shape,
      annotations: write,
    },
    tool(async (a) => (await units.add(a, actor)).map(withUnitLink)),
  );

  server.registerTool(
    'update_unit',
    {
      title: 'Update unit',
      description:
        'Change a unit: name, serial number, status, home place, network details, notes or next check date.',
      inputSchema: { ref: z.string(), ...UpdateUnitInput.shape },
      annotations: write,
    },
    tool(async ({ ref, ...patch }) => withUnitLink(await units.update(ref, patch, actor))),
  );

  server.registerTool(
    'move_unit',
    {
      title: 'Move unit',
      description:
        'Record that a unit is now somewhere else in the lab (to lend it out, use lend_unit).',
      inputSchema: { ref: z.string(), to: z.string().describe('Destination place code') },
      annotations: write,
    },
    tool(async ({ ref, to }) => withUnitLink(await services.open.moveUnit(ref, to, null, actor))),
  );

  server.registerTool(
    'put_back',
    {
      title: 'Put a unit back',
      description: 'Move a unit back to its home place.',
      inputSchema: { ref: z.string() },
      annotations: write,
    },
    tool(async ({ ref }) => withUnitLink(await services.open.putBackUnit(ref, null, actor))),
  );

  server.registerTool(
    'log_unit_event',
    {
      title: "Write in a unit's log",
      description:
        'Note, maintenance, firmware (value = version now installed), problem or repaired. Maintenance can set the next check date; problem and repaired change the status.',
      inputSchema: {
        ref: z.string(),
        kind: z.enum(UNIT_LOG_KINDS),
        text: z.string().optional(),
        value: z.string().optional(),
        nextCheckAt: z.string().optional().describe('YYYY-MM-DD'),
      },
      annotations: write,
    },
    tool(async ({ ref, ...entry }) => withUnitLink(await units.log(ref, entry, actor))),
  );

  server.registerTool(
    'list_units_needing_attention',
    {
      title: 'Units needing attention',
      description: 'Units that are reported, broken or in repair, or due for a maintenance check.',
      inputSchema: {},
      annotations: read,
    },
    tool(async () => units.attention()),
  );

  // Lost units are marked lost with update_unit (status lost); this is for when one turns up.
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
