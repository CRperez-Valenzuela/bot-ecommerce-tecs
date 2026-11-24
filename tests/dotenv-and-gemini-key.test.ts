import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GoogleGenAiClient, parseQuotaInfo } from '../src/ai/GoogleGenAiClient';
import type { GenAiLike } from '../src/ai/GoogleGenAiClient';
import { decodeEnvFile, envFileCandidates, loadDotEnv, parseDotEnv } from '../src/config/dotenv';
import { loadConfig, resolveGeminiKey } from '../src/config/env';
import { isAppError } from '../src/utils/errors';

const AQ_KEY = 'AQ.Ab8RN6Jyw-hTw4HqaKz_example.KEY';
const AIZA_KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrstuv';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-dotenv-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const utf16le = (text: string, bom: boolean): Buffer =>
  Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')]);

describe('parseDotEnv', () => {
  it('lee comillas, export, comentarios y deja "$" literal', () => {
    const { values, warnings } = parseDotEnv(
      [
        '# comentario',
        '',
        `GEMINI_API_KEY=${AQ_KEY}`,
        "STORE_NAME='Tienda $HOME #1'",
        'STORE_CITY="Acarigua\\nPortuguesa"',
        'export PORT=3000 # puerto',
        'EMPTY=',
        'SPACED =  valor con espacios  ',
      ].join('\n'),
    );
    assert.deepEqual(warnings, []);
    assert.equal(values.GEMINI_API_KEY, AQ_KEY);
    assert.equal(values.STORE_NAME, 'Tienda $HOME #1');
    assert.equal(values.STORE_CITY, 'Acarigua\nPortuguesa');
    assert.equal(values.PORT, '3000');
    assert.equal(values.EMPTY, '');
    assert.equal(values.SPACED, 'valor con espacios');
  });

  it('acepta saltos CRLF (Windows) sin dejar "\\r" en los valores', () => {
    const { values } = parseDotEnv(`A=1\r\nGEMINI_API_KEY=${AQ_KEY}\r\nB="2"\r\n`);
    assert.equal(values.A, '1');
    assert.equal(values.GEMINI_API_KEY, AQ_KEY);
    assert.equal(values.B, '2');
  });

  it('ignora el BOM al inicio: la primera variable conserva su nombre', () => {
    const { values } = parseDotEnv(`﻿GEMINI_API_KEY=${AQ_KEY}\nPORT=3000\n`);
    assert.deepEqual(Object.keys(values), ['GEMINI_API_KEY', 'PORT']);
  });

  it('avisa de lineas mal formadas y de comillas sin cerrar, sin incluir valores', () => {
    const { values, warnings } = parseDotEnv(`texto suelto\n1MALO=x\nSECRETO="abc`);
    assert.equal(values.SECRETO, 'abc');
    assert.equal(warnings.length, 3);
    assert.ok(warnings.every((w) => !w.includes('abc')));
  });
});

describe('decodeEnvFile', () => {
  const text = `GEMINI_API_KEY=${AQ_KEY}\nPORT=3000\n`;

  it('UTF-8 sin BOM, con BOM, UTF-16 LE/BE con BOM y UTF-16 LE sin BOM', () => {
    const cases: Array<[Buffer, string]> = [
      [Buffer.from(text, 'utf8'), 'utf8'],
      [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]), 'utf8-bom'],
      [utf16le(text, true), 'utf16le'],
      [utf16le(text, false), 'utf16le'],
      [(() => {
        const body = Buffer.from(text, 'utf16le');
        body.swap16();
        return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
      })(), 'utf16be'],
    ];
    for (const [buffer, encoding] of cases) {
      const decoded = decodeEnvFile(buffer);
      assert.equal(decoded.encoding, encoding);
      assert.equal(parseDotEnv(decoded.text).values.GEMINI_API_KEY, AQ_KEY, encoding);
    }
  });
});

describe('loadDotEnv', () => {
  it('carga un .env UTF-16 (el que genera PowerShell con ">") y reporta el aviso', () => {
    fs.writeFileSync(path.join(dir, '.env'), utf16le(`GEMINI_API_KEY=${AQ_KEY}\r\n`, true));
    const env: NodeJS.ProcessEnv = {};
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(report.encoding, 'utf16le');
    assert.deepEqual(report.appliedKeys, ['GEMINI_API_KEY']);
    assert.ok(report.warnings.some((w) => w.includes('UTF-8')));
  });

  it('carga un .env con BOM UTF-8 y la clave queda con el nombre correcto', () => {
    fs.writeFileSync(path.join(dir, '.env'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`GEMINI_API_KEY=${AQ_KEY}\r\n`)]));
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(Object.keys(env).some((k) => k.includes('﻿')), false);
  });

  it('el entorno real con valor gana; uno vacio o solo espacios se rellena desde el archivo', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'GEMINI_API_KEY=del_archivo\nA=del_archivo\nB=del_archivo\nC=del_archivo\n');
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: AQ_KEY, A: '', B: '   ' };
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(env.A, 'del_archivo');
    assert.equal(env.B, 'del_archivo');
    assert.equal(env.C, 'del_archivo');
    assert.deepEqual(report.keptFromEnvironment, ['GEMINI_API_KEY']);
  });

  it('busca primero en la carpeta de trabajo y despues en la raiz del proyecto', () => {
    const root = path.join(dir, 'root');
    const cwd = path.join(dir, 'cwd');
    fs.mkdirSync(root);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(root, '.env'), 'ORIGEN=raiz\n');

    const env1: NodeJS.ProcessEnv = {};
    const report1 = loadDotEnv({ cwd, projectRoot: root, env: env1 });
    assert.equal(env1.ORIGEN, 'raiz');
    assert.equal(report1.path, path.join(root, '.env'));

    fs.writeFileSync(path.join(cwd, '.env'), 'ORIGEN=cwd\n');
    const env2: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd, projectRoot: root, env: env2 });
    assert.equal(env2.ORIGEN, 'cwd');
    assert.equal(envFileCandidates({ cwd: root, projectRoot: root }).length, 1);
  });

  it('sin .env no falla: informa donde busco', () => {
    const env: NodeJS.ProcessEnv = {};
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(report.path, null);
    assert.deepEqual(report.searched, [path.join(dir, '.env')]);
    assert.deepEqual(env, {});
  });

  it('un .env ilegible (es una carpeta) no lanza excepcion', () => {
    fs.mkdirSync(path.join(dir, '.env'));
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env: {} });
    assert.equal(report.path, null);
  });

  it('el informe nunca contiene valores', () => {
    fs.writeFileSync(path.join(dir, '.env'), `GEMINI_API_KEY=${AQ_KEY}\nmalo\n`);
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env: {} });
    assert.equal(JSON.stringify(report).includes(AQ_KEY), false);
  });
});

describe('resolveGeminiKey / loadConfig', () => {
  it('acepta claves AQ.Ab... y AIza... sin validar prefijo ni longitud', () => {
    for (const key of [AQ_KEY, AIZA_KEY, 'AQ.x', 'cualquier-formato-futuro-0123456789']) {
      const resolved = resolveGeminiKey({ GEMINI_API_KEY: key });
      assert.equal(resolved.key, key);
      assert.equal(resolved.warning, null);
      assert.equal(loadConfig({ GEMINI_API_KEY: key }).gemini.apiKey, key);
    }
  });

  it('quita comillas, espacios y caracteres invisibles', () => {
    for (const raw of [`"${AQ_KEY}"`, `'${AQ_KEY}'`, `  ${AQ_KEY}  `, `﻿${AQ_KEY}`, `${AQ_KEY}​`, `${AQ_KEY}\r`]) {
      assert.equal(resolveGeminiKey({ GEMINI_API_KEY: raw }).key, AQ_KEY, JSON.stringify(raw));
    }
  });

  it('GEMINI_API_KEY manda; GOOGLE_API_KEY es alternativa si la primera esta vacia', () => {
    assert.equal(resolveGeminiKey({ GEMINI_API_KEY: AQ_KEY, GOOGLE_API_KEY: AIZA_KEY }).source, 'GEMINI_API_KEY');
    const fallback = resolveGeminiKey({ GEMINI_API_KEY: '', GOOGLE_API_KEY: AIZA_KEY });
    assert.equal(fallback.key, AIZA_KEY);
    assert.equal(fallback.source, 'GOOGLE_API_KEY');
  });

  it('sin clave devuelve null; con espacios internos o ejemplo avisa sin incluir la clave', () => {
    assert.deepEqual(resolveGeminiKey({}), { key: null, source: null, warning: null });
    assert.equal(resolveGeminiKey({ GEMINI_API_KEY: '   ' }).key, null);

    const spaced = resolveGeminiKey({ GEMINI_API_KEY: 'AQ.Ab 123' });
    assert.ok(spaced.warning?.includes('espacios'));
    assert.equal(spaced.warning?.includes('AQ.Ab'), false);

    assert.ok(resolveGeminiKey({ GEMINI_API_KEY: 'tu_clave_aqui' }).warning?.includes('ejemplo'));
  });

  it('flujo completo: .env con BOM + CRLF => loadConfig ve la clave', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`GEMINI_API_KEY="${AQ_KEY}"\r\nPORT=3100\r\n`)]),
    );
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd: dir, projectRoot: dir, env });
    const config = loadConfig(env);
    assert.equal(config.gemini.apiKey, AQ_KEY);
    assert.equal(config.gemini.keySource, 'GEMINI_API_KEY');
    assert.equal(config.port, 3100);
  });
});

describe('GoogleGenAiClient: errores de autenticacion', () => {
  const request = {
    systemInstruction: 'sistema',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 256,
  };
  const failing = (status: number): GenAiLike => ({
    models: {
      generateContent: async () => {
        throw Object.assign(new Error(`HTTP ${status}`), { status });
      },
    },
  });

  it('401 y 403 => LLM_AUTH_ERROR con pista y sin reintentos', async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const sdk: GenAiLike = {
        models: {
          generateContent: async (params) => {
            calls += 1;
            return failing(status).models.generateContent(params);
          },
        },
      };
      const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'm', sdk });
      await assert.rejects(client.generate(request), (error: unknown) => {
        assert.ok(isAppError(error));
        assert.equal(error.code, 'LLM_AUTH_ERROR');
        assert.equal(error.httpStatus, 502);
        assert.equal(JSON.stringify(error.details).includes(AQ_KEY), false);
        return true;
      });
      assert.equal(calls, 1);
    }
  });

  it('otros fallos siguen siendo LLM_ERROR y 429 pasa a LLM_QUOTA', async () => {
    const run = async (status: number): Promise<string> => {
      const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'm', sdk: failing(status), sleep: async () => {} });
      try {
        await client.generate(request);
      } catch (error) {
        return isAppError(error) ? error.code : 'otro';
      }
      return 'sin error';
    };
    assert.equal(await run(400), 'LLM_ERROR');
    assert.equal(await run(429), 'LLM_QUOTA');
  });
});

describe('GoogleGenAiClient: modelo retirado (404)', () => {
  it('404 => LLM_MODEL_ERROR con el modelo y la pista, y el modelo por defecto es vigente', async () => {
    const sdk: GenAiLike = {
      models: {
        generateContent: async () => {
          throw Object.assign(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'), { status: 404 });
        },
      },
    };
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'gemini-2.5-flash', sdk });
    await assert.rejects(
      client.generate({ systemInstruction: 's', messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hola' }] }], tools: [], temperature: 0.4, maxOutputTokens: 64 }),
      (error: unknown) => {
        assert.ok(isAppError(error));
        assert.equal(error.code, 'LLM_MODEL_ERROR');
        assert.match(error.message, /gemini-2\.5-flash/);
        assert.equal((error.details as { model: string }).model, 'gemini-2.5-flash');
        assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['gemini-2.5-flash']);
        return true;
      },
    );
    assert.equal(loadConfig({}).gemini.model, 'gemini-3.8-flash');
    assert.equal(loadConfig({ GEMINI_MODEL: 'otro-modelo' }).gemini.model, 'otro-modelo');
  });
});

describe('GoogleGenAiClient: alta demanda (503) con reintentos', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'hola, soy el bot' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;
  const unavailable = (): Error => Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 });

  /** SDK que falla segun un guion por modelo y registra las llamadas. */
  function scripted(script: Record<string, Array<'503' | 'ok' | '429'>>): { sdk: GenAiLike; calls: string[] } {
    const calls: string[] = [];
    const counters: Record<string, number> = {};
    const sdk: GenAiLike = {
      models: {
        generateContent: async (params) => {
          const model = (params as { model: string }).model;
          calls.push(model);
          const index = counters[model] ?? 0;
          counters[model] = index + 1;
          const step = script[model]?.[index] ?? script[model]?.at(-1) ?? 'ok';
          if (step === 'ok') return okResponse;
          if (step === '429') throw Object.assign(new Error('cuota'), { status: 429 });
          throw unavailable();
        },
      },
    };
    return { sdk, calls };
  }

  it('reintenta con espera exponencial y termina bien (503, 503, ok)', async () => {
    const { sdk, calls } = scripted({ principal: ['503', '503', 'ok'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', sdk, sleep: async (ms) => void waits.push(ms), random: () => 0 });
    const message = await client.generate(request);
    assert.deepEqual(calls, ['principal', 'principal', 'principal']);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(message.parts[0]?.kind, 'text');
  });

  it('el retroceso tiene tope de 8 s y suma azar acotado', async () => {
    const { sdk } = scripted({ principal: ['503'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', maxRetries: 6, retryBaseMs: 3000, sdk, sleep: async (ms) => void waits.push(ms), random: () => 0.999 });
    await assert.rejects(client.generate(request));
    assert.equal(waits.length, 6);
    assert.ok(waits.every((w) => w <= 8000 + 1500));
    assert.equal(waits[0], 3000 + Math.floor(0.999 * 1500));
  });

  it('agotados los reintentos => LLM_UNAVAILABLE (503) con intentos y sin tocar la clave', async () => {
    const { sdk, calls } = scripted({ principal: ['503'] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.equal(error.httpStatus, 503);
      assert.equal((error.details as { attempts: number }).attempts, 4);
      return true;
    });
    assert.equal(calls.length, 4);
  });

  it('con GEMINI_FALLBACK_MODEL prueba el alternativo tras agotar el principal', async () => {
    const { sdk, calls } = scripted({ principal: ['503'], respaldo: ['ok'] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['respaldo'], maxRetries: 1, sdk, sleep: async () => {} });
    await client.generate(request);
    assert.deepEqual(calls, ['principal', 'principal', 'respaldo']);
  });

  it('un modelo alternativo igual al principal se ignora; si ambos fallan sigue LLM_UNAVAILABLE', async () => {
    const same = scripted({ principal: ['503'] });
    await assert.rejects(new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['principal'], maxRetries: 0, sdk: same.sdk, sleep: async () => {} }).generate(request));
    assert.deepEqual(same.calls, ['principal']);

    const both = scripted({ principal: ['503'], respaldo: ['503'] });
    await assert.rejects(
      new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['respaldo'], maxRetries: 0, sdk: both.sdk, sleep: async () => {} }).generate(request),
      (error: unknown) => isAppError(error) && error.code === 'LLM_UNAVAILABLE',
    );
    assert.deepEqual(both.calls, ['principal', 'respaldo']);
  });

  it('GEMINI_MAX_RETRIES=0 no reintenta; 404 y 400 nunca se reintentan', async () => {
    const none = scripted({ principal: ['503'] });
    await assert.rejects(new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', maxRetries: 0, sdk: none.sdk, sleep: async () => {} }).generate(request));
    assert.equal(none.calls.length, 1);
  });

  it('la configuracion lee GEMINI_MAX_RETRIES, GEMINI_RETRY_BASE_MS y GEMINI_FALLBACK_MODEL', () => {
    const defaults = loadConfig({}).gemini;
    assert.deepEqual([defaults.maxRetries, defaults.retryBaseMs, defaults.fallbackModels, defaults.requestTimeoutMs], [3, 1000, [], 20000]);
    const custom = loadConfig({ GEMINI_MAX_RETRIES: '5', GEMINI_RETRY_BASE_MS: '250', GEMINI_FALLBACK_MODEL: ' a , b ,, ', GEMINI_REQUEST_TIMEOUT_MS: '5000' }).gemini;
    assert.deepEqual([custom.maxRetries, custom.retryBaseMs, custom.fallbackModels, custom.requestTimeoutMs], [5, 250, ['a', 'b'], 5000]);
    assert.throws(() => loadConfig({ GEMINI_REQUEST_TIMEOUT_MS: '10' }));
    assert.throws(() => loadConfig({ GEMINI_MAX_RETRIES: '99' }));
  });
});

describe('GoogleGenAiClient: timeout por intento y cadena de modelos', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'listo' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;

  /** SDK por modelo: 'cuelga' no responde nunca; 'ok' responde; '503' falla. */
  function sdkWith(behavior: Record<string, 'cuelga' | 'ok' | '503'>): { sdk: GenAiLike; calls: string[] } {
    const calls: string[] = [];
    const sdk: GenAiLike = {
      models: {
        generateContent: (params) => {
          const model = (params as { model: string }).model;
          calls.push(model);
          const mode = behavior[model] ?? 'ok';
          if (mode === 'ok') return Promise.resolve(okResponse);
          if (mode === 'cuelga') return new Promise(() => undefined);
          return Promise.reject(Object.assign(new Error('UNAVAILABLE'), { status: 503 }));
        },
      },
    };
    return { sdk, calls };
  }

  it('un intento que excede el tiempo maximo no se reintenta y pasa al siguiente modelo', async () => {
    const { sdk, calls } = sdkWith({ lento: 'cuelga', rapido: 'ok' });
    const started = Date.now();
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'lento', fallbackModels: ['rapido'], requestTimeoutMs: 40, sdk, sleep: async () => {} });
    const message = await client.generate(request);
    assert.deepEqual(calls, ['lento', 'rapido']);
    assert.equal(message.parts[0]?.kind, 'text');
    assert.ok(Date.now() - started < 1000);
  });

  it('cadena de varios modelos en orden; si todos fallan => LLM_UNAVAILABLE con modelsTried', async () => {
    const { sdk, calls } = sdkWith({ a: '503', b: 'cuelga', c: '503' });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b', 'c', 'a'], maxRetries: 0, requestTimeoutMs: 30, sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['a', 'b', 'c']);
      return true;
    });
    assert.deepEqual(calls, ['a', 'b', 'c']);
  });

  it('solo timeout en un unico modelo => LLM_UNAVAILABLE con timedOut:true', async () => {
    const { sdk } = sdkWith({ x: 'cuelga' });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'x', requestTimeoutMs: 30, sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal((error.details as { timedOut: boolean }).timedOut, true);
      return true;
    });
  });
});

describe('GoogleGenAiClient: cuota agotada (429)', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'listo' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;
  const minuteBody = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
      ],
    },
  });
  const dayBody = JSON.stringify({
    error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] },
  });

  /** Cada modelo: lista de pasos ('ok' o el cuerpo de un 429); el ultimo paso se repite. */
  function quotaSdk(script: Record<string, string[]>): { sdk: GenAiLike; calls: string[] } {
    const calls: string[] = [];
    const counters: Record<string, number> = {};
    const sdk: GenAiLike = {
      models: {
        generateContent: async (params) => {
          const model = (params as { model: string }).model;
          calls.push(model);
          const steps = script[model] ?? ['ok'];
          const step = steps[Math.min(counters[model] ?? 0, steps.length - 1)] ?? 'ok';
          counters[model] = (counters[model] ?? 0) + 1;
          if (step === 'ok') return okResponse;
          throw Object.assign(new Error(step), { status: 429 });
        },
      },
    };
    return { sdk, calls };
  }

  it('parseQuotaInfo lee espera y alcance (minuto/dia) y tolera formatos raros', () => {
    assert.deepEqual(parseQuotaInfo(new Error(minuteBody)), { scope: 'minute', retryAfterMs: 12000 });
    assert.deepEqual(parseQuotaInfo(new Error(dayBody)), { scope: 'day', retryAfterMs: null });
    assert.deepEqual(parseQuotaInfo(new Error('Please retry in 34.5s.')), { scope: 'unknown', retryAfterMs: 34500 });
    assert.deepEqual(parseQuotaInfo('texto raro'), { scope: 'unknown', retryAfterMs: null });
    assert.deepEqual(parseQuotaInfo(undefined), { scope: 'unknown', retryAfterMs: null });
  });

  it('con modelo de respaldo, un 429 pasa al instante al siguiente (sin esperar ni reintentar)', async () => {
    const { sdk, calls } = quotaSdk({ a: [minuteBody], b: ['ok'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b'], sdk, sleep: async (ms) => void waits.push(ms) });
    await client.generate(request);
    assert.deepEqual(calls, ['a', 'b']);
    assert.deepEqual(waits, []);
  });

  it('sin respaldo, espera lo que pide Google (12 s + azar) y reintenta una vez', async () => {
    const { sdk, calls } = quotaSdk({ a: [minuteBody, 'ok'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', sdk, sleep: async (ms) => void waits.push(ms), random: () => 0 });
    await client.generate(request);
    assert.deepEqual(calls, ['a', 'a']);
    assert.deepEqual(waits, [12000]);
  });

  it('si Google pide esperar mas que GEMINI_QUOTA_MAX_WAIT_MS => LLM_QUOTA sin esperar', async () => {
    const { sdk, calls } = quotaSdk({ a: [minuteBody] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', quotaMaxWaitMs: 5000, sdk, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_QUOTA');
      assert.equal(error.httpStatus, 429);
      const details = error.details as { scope: string; retryAfterSeconds: number | null; modelsTried: string[] };
      assert.deepEqual([details.scope, details.retryAfterSeconds, details.modelsTried], ['minute', 12, ['a']]);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it('cuota diaria: no se espera; con todos los modelos agotados => LLM_QUOTA con todos los modelos', async () => {
    const { sdk, calls } = quotaSdk({ a: [dayBody], b: [dayBody] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b'], sdk, sleep: async () => { throw new Error('no debe esperar'); } });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_QUOTA');
      assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['a', 'b']);
      return true;
    });
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('429 sin informacion de espera en el ultimo modelo usa el retroceso exponencial habitual', async () => {
    const { sdk, calls } = quotaSdk({ a: ['cuota', 'cuota', 'ok'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', sdk, sleep: async (ms) => void waits.push(ms), random: () => 0 });
    await client.generate(request);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [1000, 2000]);
  });

  it('la configuracion lee GEMINI_QUOTA_MAX_WAIT_MS', () => {
    assert.equal(loadConfig({}).gemini.quotaMaxWaitMs, 20000);
    assert.equal(loadConfig({ GEMINI_QUOTA_MAX_WAIT_MS: '0' }).gemini.quotaMaxWaitMs, 0);
    assert.throws(() => loadConfig({ GEMINI_QUOTA_MAX_WAIT_MS: '999999' }));
  });
});

describe('GoogleGenAiClient: modelo no disponible (404) con cadena de respaldo', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'listo' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;
  const sdkFor = (available: string[]): { sdk: GenAiLike; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      sdk: {
        models: {
          generateContent: async (params) => {
            const model = (params as { model: string }).model;
            calls.push(model);
            if (available.includes(model)) return okResponse;
            throw Object.assign(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'), { status: 404 });
          },
        },
      },
    };
  };

  it('si el principal da 404 usa el siguiente modelo sin reintentar ni esperar', async () => {
    const { sdk, calls } = sdkFor(['b']);
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b'], sdk, sleep: async () => { throw new Error('no debe esperar'); } });
    await client.generate(request);
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('si ninguno esta disponible => LLM_MODEL_ERROR que nombra todos los modelos probados', async () => {
    const { sdk, calls } = sdkFor([]);
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b', 'c'], sdk });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_MODEL_ERROR');
      assert.match(error.message, /"a", "b", "c"/);
      assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['a', 'b', 'c']);
      return true;
    });
    assert.deepEqual(calls, ['a', 'b', 'c']);
  });

  it('un respaldo con 404 no oculta el problema real del principal (429/503): se informa el del principal', async () => {
    const make = (status: number): GenAiLike => ({
      models: {
        generateContent: async (params) => {
          const model = (params as { model: string }).model;
          throw Object.assign(new Error(model === 'a' ? 'cuota agotada' : '{"error":{"code":404}}'), { status: model === 'a' ? status : 404 });
        },
      },
    });
    for (const [status, code] of [[429, 'LLM_QUOTA'], [503, 'LLM_UNAVAILABLE']] as const) {
      const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['retirado'], maxRetries: 0, sdk: make(status), sleep: async () => {} });
      await assert.rejects(client.generate(request), (error: unknown) => {
        assert.ok(isAppError(error));
        assert.equal(error.code, code);
        assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['a', 'retirado']);
        return true;
      });
    }
  });
});
