import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ErrorRequestHandler } from 'express';
import { AppError, isAppError, toErrorResponse } from '../utils/errors';
import type { Logger } from '../utils/logger';

/** Encadena promesas rechazadas al manejador de errores (Express 4 no lo hace solo). */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`, 404));
};

interface BodyParserError {
  type?: unknown;
  status?: unknown;
}

function asBodyParserError(error: unknown): BodyParserError | null {
  return typeof error === 'object' && error !== null ? (error as BodyParserError) : null;
}

/** Traduce cualquier error a { success: false, error: { code, message, details } }. */
export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    let normalized: unknown = error;
    const parserError = asBodyParserError(error);
    if (!isAppError(error) && parserError?.type === 'entity.parse.failed') {
      normalized = new AppError('BAD_REQUEST', 'El cuerpo de la peticion no es JSON valido', 400);
    } else if (!isAppError(error) && parserError?.type === 'entity.too.large') {
      normalized = new AppError('BAD_REQUEST', 'El cuerpo de la peticion es demasiado grande', 413);
    }

    const { status, body } = toErrorResponse(normalized);
    if (status >= 500) log.error('Error al procesar la peticion', { code: body.error.code, error });
    else log.debug('Peticion rechazada', { code: body.error.code, status });
    res.status(status).json(body);
  };
}
