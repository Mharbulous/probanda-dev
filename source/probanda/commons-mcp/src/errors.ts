export class DataServerError extends Error {
  readonly code: string;

  constructor(message: string, code = "data_error") {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends DataServerError {}

export class NotFoundError extends DataServerError {}

export class AmbiguousMatchError extends DataServerError {}

export class CryptoAuthError extends DataServerError {}

export class CryptoLockedError extends DataServerError {
  constructor(message = "cloud data is locked; unlock before using data tools") {
    super(message, "locked");
  }
}

export class AuthRequiredError extends DataServerError {
  constructor(message = "cloud data is not signed in; sign in before using data tools") {
    super(message, "not_signed_in");
  }
}

export class TransportError extends DataServerError {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
