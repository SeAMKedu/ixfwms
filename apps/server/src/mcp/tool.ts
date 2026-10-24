import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AppError, ruleConflict } from '../lib/errors.js';

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
