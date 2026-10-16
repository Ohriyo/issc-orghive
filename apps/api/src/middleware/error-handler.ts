import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ErrorCode, type ApiErrorBody } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Logger } from '#src/logger';

function body(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** Errors thrown by express.json() carry a `type` and `status`. */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound('Route not found'));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    // Errors are never cached, even on routes that set public Cache-Control.
    res.set('Cache-Control', 'no-store');

    if (err instanceof AppError) {
      res.status(err.status).json(body(err.code, err.message));
      return;
    }

    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
        .join('; ');
      res.status(400).json(body(ErrorCode.VALIDATION_ERROR, message));
      return;
    }

    if (isBodyParserError(err)) {
      if (err.type === 'entity.parse.failed') {
        res.status(400).json(body(ErrorCode.INVALID_JSON, 'Request body is not valid JSON'));
        return;
      }
      if (err.type === 'entity.too.large') {
        res.status(413).json(body(ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large'));
        return;
      }
    }

    // Unexpected: log method and path only (never the body), and hide details from the client.
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
    res.status(500).json(body(ErrorCode.INTERNAL_ERROR, 'Something went wrong'));
  };
}
