import type { ApiErrorResponse } from '../types/api';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'CONFIG_ERROR'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_ERROR'
  | 'LLM_AUTH_ERROR'
  | 'LLM_MODEL_ERROR'
  | 'LLM_UNAVAILABLE'
  | 'LLM_QUOTA'
  | 'REPOSITORY_ERROR'
  | 'ODOO_UNREACHABLE'
  | 'ODOO_AUTH_FAILED'
  | 'ODOO_RPC_ERROR'
  | 'CHANNEL_ERROR'
  | 'CHANNEL_RESTRICTED'
  | 'NEEDS_CLARIFICATION'
  | 'DISPLAY_LIMIT_REACHED'
  | 'BUILD_PROFILE_INCOMPLETE'
  | 'BUILD_INCOMPLETE'
  | 'COMPONENT_NOT_FOUND'
  | 'OUT_OF_STOCK'
  | 'INCOMPATIBLE_COMPONENT'
  | 'INTERNAL_ERROR';

export type ErrorDetails = Record<string, unknown> | unknown[] | string | null;

/** Error de dominio con codigo estable y estado HTTP asociado. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details: ErrorDetails = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Convierte cualquier error en la respuesta JSON estandarizada del sistema. */
export function toErrorResponse(error: unknown): { status: number; body: ApiErrorResponse } {
  if (isAppError(error)) {
    return {
      status: error.httpStatus,
      body: {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', details: null },
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
