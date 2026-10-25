export class DataServerError extends Error {
  readonly code: string;

  constructor(message: string, code = "data_error") {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends DataServerError {}

export class TransportError extends DataServerError {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
