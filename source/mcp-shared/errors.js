// The error classes every server shares, so one class identity serves each bundle's
// instanceof checks. Plain JavaScript for the reason given in dpapi-store.js.

export class DataServerError extends Error {
  constructor(message, code = "data_error", details) {
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
  constructor(message) {
    super(message, "python_timeout");
  }
}

export class AmbiguousMatchError extends DataServerError {}

export class TransportError extends DataServerError {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
