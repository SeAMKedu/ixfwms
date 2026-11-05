import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor } from '../lib/context.js';
import { TOOLS, type Services } from '../modules/index.js';
import { MCP_INSTRUCTIONS } from './instructions.js';
import { linksFor, type ToolContext } from './tool.js';

/** Builds an MCP server bound to one caller. Stateless: a new instance per HTTP request. */
export function createMcpServer(
  services: Services,
  actor: Actor,
  baseUrl: string,
  version: string,
): McpServer {
  const server = new McpServer({ name: 'ixfwms', version }, { instructions: MCP_INSTRUCTIONS });
  const ctx: ToolContext = { services, actor, baseUrl, links: linksFor(baseUrl) };
  for (const tools of TOOLS) tools(server, ctx);
  return server;
}
