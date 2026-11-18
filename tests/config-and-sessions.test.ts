import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CATEGORY_MAP, loadConfig } from '../src/config/env';
import { SessionStore } from '../src/services/SessionStore';
import { isAppError, toErrorResponse, AppError } from '../src/utils/errors';
import { createLogger } from '../src/utils/logger';
import { optEnum, optNumber, reqString } from '../src/utils/validators';

describe('loadConfig', () => {
  it('por defecto arranca en modo mock sin credenciales', () => {
    const config = loadConfig({});
    assert.equal(config.odooMode, 'mock');
    assert.equal(config.odoo, null);
    assert.equal(config.gemini.apiKey, null);
    assert.equal(config.port, 3000);
    assert.equal(config.channels.graphVersion, 'v23.0');
  });

  it('modo live exige TODAS las credenciales de Odoo y las reporta juntas', () => {
    assert.throws(
      () => loadConfig({ ODOO_MODE: 'live' }),
      (error: unknown) =>
        isAppError(error) &&
        error.code === 'CONFIG_ERROR' &&
        Array.isArray(error.details) &&
        ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_PASSWORD'].every((k) => (error.details as string[]).some((d) => d.includes(k))),
    );
  });

  it('modo live valido: normaliza la URL y mezcla el mapa de categorias', () => {
    const config = loadConfig({
      ODOO_MODE: 'live',
      ODOO_URL: 'https://odoo.tecs.local///',
      ODOO_DB: 'tecs',
      ODOO_USERNAME: 'bot',
      ODOO_PASSWORD: 'x',
      ODOO_CATEGORY_MAP: '{"case":"Gabinetes"}',
      ODOO_CREATE_QUOTATION: 'true',
    });
    assert.equal(config.odoo?.url, 'https://odoo.tecs.local');
    assert.equal(config.odoo?.categoryMap.case, 'Gabinetes');
    assert.equal(config.odoo?.categoryMap.cpu, DEFAULT_CATEGORY_MAP.cpu);
    assert.equal(config.odoo?.createQuotation, true);
  });

  it('rechaza valores invalidos', () => {
    assert.throws(() => loadConfig({ ODOO_MODE: 'produccion' }), /invalida/);
    assert.throws(() => loadConfig({ PORT: '99999' }), /invalida/);
    assert.throws(
      () => loadConfig({ ODOO_MODE: 'live', ODOO_URL: 'u', ODOO_DB: 'd', ODOO_USERNAME: 'u', ODOO_PASSWORD: 'p', ODOO_CATEGORY_MAP: '{"monitor":"X"}' }),
      /invalida/,
    );
  });
});

describe('SessionStore', () => {
  it('expira por TTL y crea una sesion nueva', () => {
    let now = 0;
    const store = new SessionStore({ ttlMs: 1000, maxSessions: 10 }, () => now);
    const first = store.getOrCreate('a', 'web');
    first.history.push({ role: 'user', parts: [{ kind: 'text', text: 'hola' }] });
    now = 500;
    assert.equal(store.getOrCreate('a', 'web'), first);
    now = 2000;
    const second = store.getOrCreate('a', 'web');
    assert.notEqual(second, first);
    assert.equal(second.history.length, 0);
  });

  it('desaloja la mas antigua al superar el maximo y sweep limpia vencidas', () => {
    let now = 0;
    const store = new SessionStore({ ttlMs: 1000, maxSessions: 2 }, () => now);
    store.getOrCreate('a', 'web');
    store.getOrCreate('b', 'web');
    store.getOrCreate('a', 'web'); // 'a' pasa a ser la mas reciente
    store.getOrCreate('c', 'web');
    assert.equal(store.peek('b'), undefined);
    assert.ok(store.peek('a') && store.peek('c'));
    now = 5000;
    assert.equal(store.sweep(), 2);
    assert.equal(store.size(), 0);
  });

  it('runExclusive ejecuta en orden por clave y sigue funcionando tras un error', async () => {
    const store = new SessionStore({ ttlMs: 1000, maxSessions: 10 });
    const order: string[] = [];
    const slow = store.runExclusive('k', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('lento');
    });
    const failing = store.runExclusive('k', async () => {
      order.push('falla');
      throw new Error('x');
    });
    const last = store.runExclusive('k', async () => void order.push('ultimo'));
    const other = store.runExclusive('otra', async () => void order.push('otra-clave'));
    await assert.rejects(failing, /x/);
    await Promise.all([slow, last, other]);
    assert.deepEqual(order.filter((o) => o !== 'otra-clave'), ['lento', 'falla', 'ultimo']);
    assert.ok(order.indexOf('otra-clave') < order.indexOf('lento'), 'otra clave no espera');
  });
});

describe('errores y utilidades', () => {
  it('toErrorResponse devuelve siempre { success:false, error:{code,message,details} }', () => {
    const known = toErrorResponse(new AppError('NOT_FOUND', 'no esta', 404, { id: 1 }));
    assert.deepEqual(known, { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no esta', details: { id: 1 } } } });
    const unknown = toErrorResponse(new Error('secreto interno: password=123'));
    assert.equal(unknown.status, 500);
    assert.equal(unknown.body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(unknown), /password/);
  });

  it('el logger redacta secretos', () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => void lines.push(line);
    try {
      createLogger('info').info('x', { apiKey: 'AIza123', nested: { accessToken: 't', ok: 1 }, password: 'p' });
    } finally {
      console.log = original;
    }
    assert.doesNotMatch(lines[0] ?? '', /AIza123|"t"|"p"/);
    assert.match(lines[0] ?? '', /REDACTED/);
  });

  it('validadores: texto, numeros (coma decimal) y enums', () => {
    assert.throws(() => reqString({}, 'x'), /obligatorio/);
    assert.throws(() => reqString({ x: 'abcdef' }, 'x', { max: 3 }), /maximo/);
    assert.equal(optNumber({ n: '12,5' }, 'n'), 12.5);
    assert.throws(() => optNumber({ n: 'doce' }, 'n'), /numero/);
    assert.throws(() => optNumber({ n: 5 }, 'n', { min: 10 }), /minimo/);
    assert.equal(optEnum({ e: 'a' }, 'e', ['a', 'b'] as const), 'a');
    assert.throws(() => optEnum({ e: 'z' }, 'e', ['a', 'b'] as const), /permitidos/);
  });
});
