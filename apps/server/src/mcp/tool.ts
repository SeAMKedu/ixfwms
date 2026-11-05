import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Actor } from '../lib/context.js';
import { AppError, ruleConflict } from '../lib/errors.js';
import type { Services } from '../modules/index.js';

type Handler<A> = (args: A) => Promise<unknown>;

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] };
}

/** Wraps a tool handler: AppErrors become readable tool errors instead of protocol failures. */
export function tool<A>(fn: Handler<A>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (thrown) {
      const err = ruleConflict(thrown) ?? thrown;
      if (err instanceof AppError)
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      if (err instanceof z.ZodError) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${z.prettifyError(err)}` }],
        };
      }
      throw err;
    }
  };
}

export const read = { readOnlyHint: true, openWorldHint: false } as const;
export const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** What every module's MCP tools get: the services, who is asking, and links back to the app. */
export interface ToolContext {
  services: Services;
  actor: Actor;
  baseUrl: string;
  links: ReturnType<typeof linksFor>;
}

/** Links into the web app for what tools return, so an assistant can hand them to people. */
export function linksFor(baseUrl: string) {
  return {
    /** An app-relative href (attachments, files) made absolute. */
    abs: (href: string) => (href.startsWith('/') ? `${baseUrl}${href}` : href),
    part: (code: string) => `${baseUrl}/p/${code}`,
    unit: (code: string) => `${baseUrl}/u/${code}`,
    place: (code: string) => `${baseUrl}/l/${code}`,
  };
}
