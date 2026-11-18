import { AppError } from '../utils/errors';

export interface HttpRequestInit {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  json: unknown;
}

export type HttpFn = (url: string, init: HttpRequestInit) => Promise<HttpResult>;

/** fetch con timeout. No lanza por estados no-2xx; solo ante fallas de red/timeout. */
export const httpRequest: HttpFn = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = raw === '' ? null : (JSON.parse(raw) as unknown);
    } catch {
      json = raw;
    }
    return { status: response.status, ok: response.ok, json };
  } catch (error) {
    throw new AppError('CHANNEL_ERROR', 'Fallo la comunicacion con la plataforma del canal', 502, {
      host: safeHost(url),
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
};

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'desconocido';
  }
}
