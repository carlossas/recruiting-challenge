/**
 * Adapter for async route handlers.
 *
 * Express 4 doesn't forward rejected promises to the error middleware, so an `async` handler
 * that throws would hang the request. Wrapping it routes the rejection to `next`.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async handler so rejections reach the error middleware.
 *
 * @param handler - Async route handler.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
