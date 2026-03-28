export enum BridgeErrorCode {
  UNKNOWN_AGENT = 'UNKNOWN_AGENT',
  BLOCKED_FILE = 'BLOCKED_FILE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  NOT_RECEIVER = 'NOT_RECEIVER',
  NOT_PARTICIPANT = 'NOT_PARTICIPANT',
  TASK_CLOSED = 'TASK_CLOSED',
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  DB_ERROR = 'DB_ERROR',
}

export class BridgeError extends Error {
  constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
