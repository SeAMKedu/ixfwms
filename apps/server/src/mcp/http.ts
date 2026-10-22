import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { baseUrl, type AppDeps } from '../http/context.js';
import { createMcpServer } from './server.js';

/**
 * MCP over Streamable HTTP at /mcp, stateless (a fresh server per request) and JSON responses.
 * Clients authenticate with the same API tokens as the REST API.
 */
export function registerMcp(app: FastifyInstance, { config, services, version }: AppDeps): void {
  app.post('/mcp', async (request, reply) => {
    if (!request.actor) {
      return reply
        .status(401)
        .header('www-authenticate', 'Bearer realm="ixfwms"')
        .send({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Send an ixfwms API token as "Authorization: Bearer ixf_…"',
          },
          id: null,
        });
    }
    const server = createMcpServer(services, request.actor, baseUrl(config, request), version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  const notAllowed = {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this MCP server is stateless, use POST' },
    id: null,
  };
  app.get('/mcp', (_request, reply) => reply.status(405).header('allow', 'POST').send(notAllowed));
  app.delete('/mcp', (_request, reply) =>
    reply.status(405).header('allow', 'POST').send(notAllowed),
  );
}
