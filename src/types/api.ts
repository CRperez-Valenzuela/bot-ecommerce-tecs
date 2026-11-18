import type { ErrorCode, ErrorDetails } from '../utils/errors';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details: ErrorDetails;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
