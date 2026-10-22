import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Actor, Services } from '../services/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface AppDeps {
  config: Config;
  services: Services;
  version: string;
}

/**
 * The URL clients should use for this server: the configured IXF_PUBLIC_URL, or else whatever
 * host the request came in on (so it works by IP, by mDNS name or by DNS name alike).
 */
export function baseUrl(config: Pick<Config, 'publicUrl'>, request: FastifyRequest): string {
  return config.publicUrl ?? `${request.protocol}://${request.host}`;
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

/** Query-string friendly booleans: "1", "true", "yes". */
export const QueryBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));
