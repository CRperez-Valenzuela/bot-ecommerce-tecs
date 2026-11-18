import { isRecord } from '../utils/validators';

/** Helpers para navegar payloads de webhooks (entrada no confiable) sin usar `any`. */
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function rec(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
