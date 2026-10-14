import { ErrorCode } from '@orghive/shared';

/** An expected error that maps to an HTTP status and a safe, user-facing message. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have permission to do this') {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }
}
