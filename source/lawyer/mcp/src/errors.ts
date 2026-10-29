export class DataServerError extends Error {
  readonly code: string;
  /** Structured detail the error payload carries beside its message, when the refusal has any. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, code = "data_error", details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DataServerError {}

export class NotFoundError extends DataServerError {}

/** A host Python process did not answer within its budget and was killed (issue #517). */
export class PythonTimeoutError extends DataServerError {
  constructor(message: string) {
    super(message, "python_timeout");
  }
}

export class AmbiguousMatchError extends DataServerError {}
