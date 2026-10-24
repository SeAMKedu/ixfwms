import { errorMessage, type ErrorKey, type ErrorParams } from '@ixfwms/domain';

export type ErrorCode = 'not_found' | 'invalid' | 'conflict' | 'forbidden' | 'unauthorized';

const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
};

/**
 * Errors the services raise on purpose; HTTP and MCP adapters turn them into responses. Most
 * carry a key from the shared catalogue (ERROR_MESSAGES), so the web app can show them in the
 * user's language; the message is the English text.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly key?: ErrorKey,
    readonly params?: ErrorParams,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** An error whose message comes from the catalogue. */
export const fail = (code: ErrorCode, key: ErrorKey, params: ErrorParams = {}, details?: unknown) =>
  new AppError(code, errorMessage(key, params), details, key, params);

type NotFoundKey =
  Extract<ErrorKey, `notFound.${string}`> extends `notFound.${infer K}` ? K : never;

export const notFound = (what: NotFoundKey, ref: string) =>
  fail('not_found', `notFound.${what}` as ErrorKey, { ref });
export const invalid = (key: ErrorKey, params?: ErrorParams, details?: unknown) =>
  fail('invalid', key, params, details);
export const conflict = (key: ErrorKey, params?: ErrorParams) => fail('conflict', key, params);
