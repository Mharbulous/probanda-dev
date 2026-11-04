// Types for errors.js. Keep in step with it.

export declare class DataServerError extends Error {
  readonly code: string;
  /** Structured detail the error payload carries beside its message, when the refusal has any. */
  readonly details?: Record<string, unknown>;
  constructor(message: string, code?: string, details?: Record<string, unknown>);
}

export declare class ValidationError extends DataServerError {}

export declare class NotFoundError extends DataServerError {}

export declare class PythonTimeoutError extends DataServerError {
  constructor(message: string);
}

export declare class AmbiguousMatchError extends DataServerError {}

export declare class TransportError extends DataServerError {
  status?: number;
  constructor(message: string, status?: number);
}
