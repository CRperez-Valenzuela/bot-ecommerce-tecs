import { AppError } from './errors';

export type Args = Record<string, unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(key: string, reason: string): AppError {
  return new AppError('VALIDATION_ERROR', `Parametro "${key}" invalido: ${reason}`, 400, { field: key });
}

export interface StringOptions {
  min?: number;
  max?: number;
}

export function optString(args: Args, key: string, options: StringOptions = {}): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw invalid(key, 'debe ser texto');
  const value = raw.trim();
  if (value === '') return undefined;
  if (options.max !== undefined && value.length > options.max) {
    throw invalid(key, `maximo ${options.max} caracteres`);
  }
  if (options.min !== undefined && value.length < options.min) {
    throw invalid(key, `minimo ${options.min} caracteres`);
  }
  return value;
}

export function reqString(args: Args, key: string, options: StringOptions = {}): string {
  const value = optString(args, key, options);
  if (value === undefined) throw invalid(key, 'es obligatorio');
  return value;
}

export interface NumberOptions {
  min?: number;
  max?: number;
}

export function optNumber(args: Args, key: string, options: NumberOptions = {}): number | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN;
  if (!Number.isFinite(value)) throw invalid(key, 'debe ser un numero');
  if (options.min !== undefined && value < options.min) throw invalid(key, `minimo ${options.min}`);
  if (options.max !== undefined && value > options.max) throw invalid(key, `maximo ${options.max}`);
  return value;
}

export function reqNumber(args: Args, key: string, options: NumberOptions = {}): number {
  const value = optNumber(args, key, options);
  if (value === undefined) throw invalid(key, 'es obligatorio');
  return value;
}

export function optBoolean(args: Args, key: string): boolean | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw invalid(key, 'debe ser booleano');
}

export function optEnum<T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const value = optString(args, key);
  if (value === undefined) return undefined;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalid(key, `valores permitidos: ${allowed.join(', ')}`);
  return found;
}

export function reqEnum<T extends string>(args: Args, key: string, allowed: readonly T[]): T {
  const value = optEnum(args, key, allowed);
  if (value === undefined) throw invalid(key, 'es obligatorio');
  return value;
}
