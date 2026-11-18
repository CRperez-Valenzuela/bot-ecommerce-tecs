import type { RequestHandler } from 'express';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';

export interface RateLimitOptions {
  /** Solicitudes permitidas por ventana y por cliente. */
  max: number;
  windowMs: number;
  /** Tope de clientes en memoria (evita crecer sin limite ante muchas IPs distintas). */
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos hasta que la ventana del cliente se reinicia (>= 1). */
  resetInSeconds: number;
  /** true solo en la primera solicitud rechazada de la ventana (para registrar un unico aviso). */
  firstBlock: boolean;
}

interface Entry {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 20_000;

/**
 * Limitador de ventana fija, en memoria y sin dependencias. Una solicitud rechazada no extiende la ventana.
 * Es por proceso: con varias instancias cada una lleva su propia cuenta (ver CHANGELOG).
 */
export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    if (!Number.isInteger(options.max) || options.max < 1) throw new Error('RateLimiter: max debe ser un entero >= 1');
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) throw new Error('RateLimiter: windowMs invalido');
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = options.now ?? Date.now;
  }

  hit(key: string): RateLimitResult {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry === undefined || now >= entry.resetAt) {
      if (entry === undefined) this.makeRoom(now);
      entry = { count: 0, resetAt: now + this.options.windowMs };
      this.entries.set(key, entry);
    }
    entry.count += 1;

    const { max } = this.options;
    return {
      allowed: entry.count <= max,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      resetInSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      firstBlock: entry.count === max + 1,
    };
  }

  size(): number {
    return this.entries.size;
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
    }
    // Si sigue lleno, se descarta el cliente mas antiguo (orden de insercion).
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

function expandIpv6(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':').map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : Number.NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing < 1 ? null : [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Clave de limitacion para una IP: IPv4 tal cual; IPv4 mapeada en IPv6 (::ffff:a.b.c.d) como IPv4;
 * IPv6 agrupada por /64 (un cliente suele controlar todo su /64, asi no evade el limite rotando direcciones).
 */
export function normalizeClientIp(ip: string | undefined): string {
  if (ip === undefined || ip.trim() === '') return 'unknown';
  let value = ip.trim().toLowerCase();
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!value.includes(':')) return value;

  const groups = expandIpv6(value);
  if (groups === null) return value;
  return `v6:${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}`;
}

export interface RateLimitMiddlewareOptions {
  windowSeconds: number;
  log?: Logger;
}

/** Middleware Express: cabeceras RateLimit-* y, al excederse, 429 RATE_LIMITED con el formato estandar de errores. */
export function createRateLimitMiddleware(limiter: RateLimiter, options: RateLimitMiddlewareOptions): RequestHandler {
  return (req, res, next) => {
    const client = normalizeClientIp(req.ip);
    const result = limiter.hit(client);

    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.resetInSeconds));

    if (result.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(result.resetInSeconds));
    if (result.firstBlock) {
      options.log?.warn('Limite de tasa excedido', { client, limit: result.limit, windowSeconds: options.windowSeconds });
    }
    next(
      new AppError('RATE_LIMITED', 'Demasiados mensajes en poco tiempo. Intenta de nuevo en unos segundos.', 429, {
        retryAfterSeconds: result.resetInSeconds,
        limit: result.limit,
        windowSeconds: options.windowSeconds,
      }),
    );
  };
}
