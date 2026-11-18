import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { RateLimiter, createRateLimitMiddleware, normalizeClientIp } from '../src/middleware/rateLimit';
import { loadConfig } from '../src/config/env';
import { AppError, isAppError, toErrorResponse } from '../src/utils/errors';
import type { Logger } from '../src/utils/logger';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('RateLimiter', () => {
  it('permite hasta max por ventana y rechaza el resto', () => {
    const c = clock();
    const limiter = new RateLimiter({ max: 3, windowMs: 60_000, now: c.now });
    const results = [1, 2, 3, 4, 5].map(() => limiter.hit('1.1.1.1'));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
    assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0, 0]);
    assert.deepEqual(results.map((r) => r.firstBlock), [false, false, false, true, false]);
  });

  it('cada cliente tiene su propia cuenta', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: clock().now });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, false);
    assert.equal(limiter.hit('b').allowed, true);
  });

  it('la ventana se reinicia al vencer y un rechazo NO la extiende', () => {
    const c = clock();
    const limiter = new RateLimiter({ max: 1, windowMs: 10_000, now: c.now });
    limiter.hit('x');
    c.advance(9_000);
    const blocked = limiter.hit('x');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.resetInSeconds, 1);
    c.advance(1_000); // 10 s desde el primer golpe, no desde el rechazo
    assert.equal(limiter.hit('x').allowed, true);
  });

  it('resetInSeconds redondea hacia arriba y nunca baja de 1', () => {
    const c = clock();
    const limiter = new RateLimiter({ max: 5, windowMs: 60_000, now: c.now });
    assert.equal(limiter.hit('k').resetInSeconds, 60);
    c.advance(59_999);
    assert.equal(limiter.hit('k').resetInSeconds, 1);
  });

  it('la memoria esta acotada: purga vencidos y, si sigue lleno, descarta el cliente mas antiguo', () => {
    const c = clock();
    const limiter = new RateLimiter({ max: 5, windowMs: 1000, maxKeys: 3, now: c.now });
    limiter.hit('a'); limiter.hit('b'); limiter.hit('c');
    assert.equal(limiter.size(), 3);
    limiter.hit('d'); // lleno y nada vencido: sale 'a'
    assert.equal(limiter.size(), 3);
    c.advance(1500); // todo vence
    limiter.hit('e');
    assert.equal(limiter.size(), 1);
    // 'a' fue descartado: empieza de cero
    assert.equal(limiter.hit('a').remaining, 4);
  });

  it('rechaza configuracion invalida', () => {
    assert.throws(() => new RateLimiter({ max: 0, windowMs: 1000 }), /max/);
    assert.throws(() => new RateLimiter({ max: 1.5, windowMs: 1000 }), /max/);
    assert.throws(() => new RateLimiter({ max: 1, windowMs: 0 }), /windowMs/);
  });
});

describe('normalizeClientIp', () => {
  it('IPv4 tal cual; IPv4 mapeada en IPv6 como IPv4; vacio -> unknown', () => {
    assert.equal(normalizeClientIp('190.120.5.9'), '190.120.5.9');
    assert.equal(normalizeClientIp('::ffff:190.120.5.9'), '190.120.5.9');
    assert.equal(normalizeClientIp('::FFFF:10.0.0.1'), '10.0.0.1');
    assert.equal(normalizeClientIp(undefined), 'unknown');
    assert.equal(normalizeClientIp('  '), 'unknown');
  });

  it('IPv6: agrupa por /64 para que rotar direcciones del mismo prefijo no evada el limite', () => {
    const a = normalizeClientIp('2001:db8:abcd:12::1');
    const b = normalizeClientIp('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
    assert.equal(a, 'v6:2001:db8:abcd:12');
    assert.equal(a, b);
    assert.notEqual(a, normalizeClientIp('2001:db8:abcd:13::1'));
    assert.equal(normalizeClientIp('::1'), 'v6:0:0:0:0');
    assert.equal(normalizeClientIp('fe80::1%eth0'), 'v6:fe80:0:0:0');
  });

  it('entradas malformadas no lanzan', () => {
    assert.equal(typeof normalizeClientIp('zz::zz::1'), 'string');
    assert.equal(typeof normalizeClientIp('1:2:3'), 'string');
  });
});

describe('middleware de limite de tasa', () => {
  function harness(max: number) {
    const c = clock();
    const warnings: unknown[] = [];
    const log = { warn: (...args: unknown[]) => warnings.push(args) } as unknown as Logger;
    const middleware = createRateLimitMiddleware(new RateLimiter({ max, windowMs: 60_000, now: c.now }), { windowSeconds: 60, log });
    const call = (ip: string | undefined) => {
      const headers: Record<string, string> = {};
      let nextArg: unknown = 'no-llamado';
      const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
      const next: NextFunction = (arg?: unknown) => { nextArg = arg; };
      middleware({ ip } as Request, res, next);
      return { headers, nextArg };
    };
    return { call, warnings, c };
  }

  it('deja pasar con cabeceras RateLimit-* mientras no se exceda', () => {
    const { call } = harness(2);
    const first = call('5.5.5.5');
    assert.equal(first.nextArg, undefined);
    assert.deepEqual(first.headers, { 'RateLimit-Limit': '2', 'RateLimit-Remaining': '1', 'RateLimit-Reset': '60' });
  });

  it('al excederse: 429 RATE_LIMITED con el formato estandar, Retry-After y un unico aviso en el log', () => {
    const { call, warnings } = harness(1);
    call('6.6.6.6');
    const blocked = call('6.6.6.6');
    const again = call('6.6.6.6');

    assert.ok(isAppError(blocked.nextArg));
    const error = blocked.nextArg as AppError;
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.httpStatus, 429);
    assert.deepEqual(error.details, { retryAfterSeconds: 60, limit: 1, windowSeconds: 60 });
    assert.equal(blocked.headers['Retry-After'], '60');
    assert.equal(blocked.headers['RateLimit-Remaining'], '0');
    assert.equal(again.headers['Retry-After'], '60');
    assert.equal(warnings.length, 1, 'se avisa solo en el primer rechazo de la ventana');

    const response = toErrorResponse(error);
    assert.equal(response.status, 429);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'RATE_LIMITED');
  });

  it('IPs distintas no se afectan; IPv4-mapeada e IPv4 comparten cuenta', () => {
    const { call } = harness(1);
    assert.equal(call('7.7.7.7').nextArg, undefined);
    assert.equal(call('8.8.8.8').nextArg, undefined);
    assert.ok(isAppError(call('::ffff:7.7.7.7').nextArg));
  });
});

describe('configuracion del limite de tasa, proxy y logs', () => {
  it('valores por defecto', () => {
    const c = loadConfig({});
    assert.deepEqual(c.rateLimit, { enabled: true, max: 20, windowSeconds: 60 });
    assert.equal(c.trustProxy, 0);
    assert.deepEqual(c.logging, { dir: null, retentionDays: 14 });
  });

  it('lee las variables y valida rangos', () => {
    const c = loadConfig({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_SECONDS: '30', TRUST_PROXY: '1', LOG_DIR: '/app/storage/logs', LOG_RETENTION_DAYS: '7' });
    assert.deepEqual(c.rateLimit, { enabled: false, max: 5, windowSeconds: 30 });
    assert.equal(c.trustProxy, 1);
    assert.deepEqual(c.logging, { dir: '/app/storage/logs', retentionDays: 7 });
    for (const bad of [{ RATE_LIMIT_MAX: '0' }, { RATE_LIMIT_MAX: 'x' }, { RATE_LIMIT_WINDOW_SECONDS: '0' }, { TRUST_PROXY: '-1' }, { TRUST_PROXY: '11' }, { LOG_RETENTION_DAYS: '0' }]) {
      assert.throws(() => loadConfig(bad), (e: unknown) => isAppError(e) && e.code === 'CONFIG_ERROR', JSON.stringify(bad));
    }
  });
});
