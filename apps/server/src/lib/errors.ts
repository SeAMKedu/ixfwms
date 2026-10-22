export type ErrorCode = 'not_found' | 'invalid' | 'conflict' | 'forbidden' | 'unauthorized';

const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
};

/** Errors the services raise on purpose; HTTP and MCP adapters turn them into responses. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what: string, ref: string) =>
  new AppError('not_found', `${what} not found: ${ref}`);
export const invalid = (message: string, details?: unknown) =>
  new AppError('invalid', message, details);
export const conflict = (message: string) => new AppError('conflict', message);
