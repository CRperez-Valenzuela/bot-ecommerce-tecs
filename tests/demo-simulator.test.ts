import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import vm from 'node:vm';
import { GeminiService } from '../src/ai/GeminiService';
import { ToolExecutor } from '../src/ai/ToolExecutor';
import { TOOL_NAMES } from '../src/ai/tools';
import { loadConfig } from '../src/config/env';
import type { ChatDeps } from '../src/routes/chat.handlers';
import { getChatConfig, handleChat, handleReset } from '../src/routes/chat.handlers';
import { CatalogService } from '../src/services/CatalogService';
import { ConversationService } from '../src/services/ConversationService';
import { PCBuildEngine, createEmptyBuild } from '../src/services/PCBuildEngine';
import { SessionStore } from '../src/services/SessionStore';
import { BUILD_CATEGORIES } from '../src/types/domain';
import type { LlmMessage } from '../src/types/llm';
import { AppError, isAppError } from '../src/utils/errors';
import { silentLogger } from '../src/utils/logger';
import { makeMockRepo } from './helpers/fixtures';
import { ScriptedLlm, call, say } from './helpers/fakeLlm';

const STORE = { name: 'TECS', city: 'Acarigua, Portuguesa', address: 'Av. Principal, Local 5', hours: 'Lun-Sab 9am-6pm' };
const ETA = '24 a 48 horas hábiles';
const SETTINGS = { temperature: 0.4, maxToolRounds: 4, maxHistoryTurns: 14, deliveryEta: ETA };

// Armado completo y compatible (AM4 + DDR4, CPU con video integrado -> se omite la GPU).
const FULL_BUILD_SKUS = ['CPU-R5-5600G', 'MB-B550M-PRO-VDH', 'RAM-KF-16-D4', 'SSD-NV2-500', 'PSU-CV650', 'CASE-ANTEC-NX200M'];

const instances: { cleanup(): void }[] = [];
after(() => instances.forEach((i) => i.cleanup()));

function setup(script: (LlmMessage | Error)[], withEngine = true) {
  const temp = makeMockRepo();
  instances.push(temp);
  const sessions = new SessionStore({ ttlMs: 60_000, maxSessions: 100 });
  const engine = new PCBuildEngine(temp.repo, ETA);
  const tools = new ToolExecutor({ catalog: new CatalogService(temp.repo), engine, repo: temp.repo, store: STORE, log: silentLogger });
  const gemini = new GeminiService({ llm: new ScriptedLlm(script), tools, store: STORE, settings: SETTINGS, log: silentLogger });
  const conversation = new ConversationService({
    sessions,
    gemini,
    storeAddress: STORE.address,
    log: silentLogger,
    ...(withEngine ? { engine } : {}),
  });
  return { temp, sessions, engine, conversation };
}

function chatDeps(conversation: ConversationService, overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    conversation,
    apiKey: null,
    exposeDebug: true,
    info: { storeName: 'TECS', mode: 'mock', geminiConfigured: true },
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isAppError(error), `se esperaba AppError y llego: ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: 'se esperaba un rechazo' });
}

describe('PCBuildEngine.view', () => {
  it('sin armado iniciado -> null', async () => {
    const { engine } = setup([]);
    assert.equal(await engine.view(createEmptyBuild()), null);
  });

  it('armado en curso: progreso, gasto y paso siguiente; sin servicios hasta completar', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
    await engine.select(build, 'CPU-R5-5600G');

    const view = await engine.view(build);
    assert.ok(view);
    assert.equal(view.purpose, 'gaming');
    assert.equal(view.budgetUsd, 800);
    assert.deepEqual(view.selected.map((s) => s.category), ['cpu']);
    assert.equal(view.nextStep, 'motherboard');
    assert.equal(view.complete, false);
    assert.deepEqual(view.services, []);
    assert.equal(view.servicesUsd, 0);
    assert.equal(view.totalUsd, view.subtotalUsd);
    assert.equal(view.spentUsd, view.subtotalUsd);
    assert.equal(view.gpuOptional, true);
  });

  it('armado completo: suma servicios obligatorios, ETA y diferencia contra el presupuesto', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'office', budgetUsd: 500 });
    for (const sku of FULL_BUILD_SKUS) await engine.select(build, sku);
    engine.skipGpu(build);

    const view = await engine.view(build);
    assert.ok(view);
    assert.equal(view.complete, true);
    assert.equal(view.gpuSkipped, true);
    assert.equal(view.nextStep, null);
    assert.equal(view.services.length, 3);
    assert.ok(view.servicesUsd > 0);
    assert.equal(Math.round((view.subtotalUsd + view.servicesUsd) * 100), Math.round(view.totalUsd * 100));
    assert.equal(view.deliveryEta, ETA);
    assert.equal(view.budgetDeltaUsd, Math.round((view.totalUsd - 500) * 100) / 100);
    assert.deepEqual(view.issues.filter((i) => i.severity === 'error'), []);
  });

  it('es serializable a JSON sin perder datos (lo consume el simulador)', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 700 });
    await engine.select(build, 'CPU-R5-5600G');
    const view = await engine.view(build);
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  });
});

describe('ConversationService: vista del armado y reinicio', () => {
  it('cada respuesta trae la vista del armado y se actualiza al elegir componentes', async () => {
    const env = setup([
      call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }),
      say('Empecemos con el procesador.'),
      call(TOOL_NAMES.selectComponent, { sku: 'CPU-R5-5600G' }),
      say('Procesador elegido.'),
    ]);
    const first = await env.conversation.handle({ channel: 'web', externalUserId: 'v1', text: 'Quiero armar una PC gamer de 800' });
    assert.equal(first.build?.purpose, 'gaming');
    assert.deepEqual(first.build?.selected, []);

    const second = await env.conversation.handle({ channel: 'web', externalUserId: 'v1', text: 'dale con el CPU' });
    assert.deepEqual(second.build?.selected.map((s) => s.sku), ['CPU-R5-5600G']);
    assert.equal(second.build?.nextStep, 'motherboard');
  });

  it('sin armado en curso -> build null; sin motor configurado -> build null', async () => {
    const withEngine = setup([say('Hola')]);
    assert.equal((await withEngine.conversation.handle({ channel: 'web', externalUserId: 'n1', text: 'hola' })).build, null);

    const withoutEngine = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('ok')], false);
    const result = await withoutEngine.conversation.handle({ channel: 'web', externalUserId: 'n2', text: 'armar' });
    assert.equal(result.build, null);
  });

  it('si la vista falla, la respuesta al cliente NO falla (solo build null)', async () => {
    const env = setup([say('Hola')]);
    const broken = new ConversationService({
      sessions: new SessionStore({ ttlMs: 60_000, maxSessions: 10 }),
      gemini: (env.conversation as unknown as { deps: { gemini: GeminiService } }).deps.gemini,
      storeAddress: STORE.address,
      log: silentLogger,
      engine: { view: async () => { throw new Error('repositorio caido'); } } as unknown as PCBuildEngine,
    });
    const result = await broken.handle({ channel: 'web', externalUserId: 'f1', text: 'hola' });
    assert.equal(result.reply, 'Hola');
    assert.equal(result.build, null);
  });

  it('reset elimina historial y armado de ESA sesion y canal, y no toca otras', async () => {
    const env = setup([
      call(TOOL_NAMES.startBuild, { proposito: 'office', presupuesto_usd: 400 }),
      say('ok'),
      say('hola'),
    ]);
    await env.conversation.handle({ channel: 'whatsapp', externalUserId: 'r1', text: 'armar' });
    await env.conversation.handle({ channel: 'instagram', externalUserId: 'r1', text: 'hola' });
    assert.ok(env.sessions.peek('whatsapp:r1'));

    assert.equal(await env.conversation.reset('whatsapp', 'r1'), true);
    assert.equal(env.sessions.peek('whatsapp:r1'), undefined);
    assert.ok(env.sessions.peek('instagram:r1'), 'otro canal con el mismo id no se toca');
    assert.equal(await env.conversation.reset('whatsapp', 'r1'), false);
    await assert.rejects(() => env.conversation.reset('whatsapp', '  '), /identificador/);
  });
});

describe('handlers de /api/chat (sin Express)', () => {
  it('con API key: falta o es incorrecta -> UNAUTHORIZED 401; correcta -> responde', async () => {
    const env = setup([say('Hola')]);
    const deps = chatDeps(env.conversation, { apiKey: 'secreto' });
    for (const key of [undefined, 'otra', 'secret', 'secreto-x']) {
      const error = await rejection(handleChat(deps, key, { message: 'hola' }));
      assert.equal(error.code, 'UNAUTHORIZED');
      assert.equal(error.httpStatus, 401);
    }
    const ok = await handleChat(deps, 'secreto', { message: 'hola' });
    assert.equal(ok.success, true);
    assert.equal(ok.data.reply, 'Hola');
  });

  it('la clave tambien protege el reinicio', async () => {
    const env = setup([]);
    const deps = chatDeps(env.conversation, { apiKey: 'secreto' });
    const error = await rejection(handleReset(deps, undefined, { sessionId: 's' }));
    assert.equal(error.code, 'UNAUTHORIZED');
  });

  it('valida el cuerpo: no-objeto, mensaje vacio, canal invalido -> 400', async () => {
    const env = setup([say('x')]);
    const deps = chatDeps(env.conversation);
    assert.equal((await rejection(handleChat(deps, undefined, 'texto'))).code, 'BAD_REQUEST');
    assert.equal((await rejection(handleChat(deps, undefined, null))).code, 'BAD_REQUEST');
    assert.equal((await rejection(handleChat(deps, undefined, { message: '   ' }))).code, 'VALIDATION_ERROR');
    const bad = await rejection(handleChat(deps, undefined, { message: 'hola', channel: 'telegram' }));
    assert.equal(bad.code, 'VALIDATION_ERROR');
    assert.equal(bad.httpStatus, 400);
  });

  it('respuesta: canal web por defecto, sessionId generado, build y debug segun exposeDebug', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('listo'), say('hola de nuevo')]);
    const first = await handleChat(chatDeps(env.conversation), undefined, { message: 'armar una PC' });
    assert.equal(first.data.channel, 'web');
    assert.match(first.data.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(first.data.build?.purpose, 'gaming');
    assert.deepEqual(first.data.debug, { toolsUsed: [TOOL_NAMES.startBuild] });

    const prod = await handleChat(chatDeps(env.conversation, { exposeDebug: false }), undefined, {
      message: 'hola',
      sessionId: first.data.sessionId,
    });
    assert.equal('debug' in prod.data, false);
    assert.equal(prod.data.sessionId, first.data.sessionId);
  });

  it('el estado de dos canales con el mismo sessionId es independiente', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('a'), say('b')]);
    const deps = chatDeps(env.conversation);
    const wa = await handleChat(deps, undefined, { message: 'armar', channel: 'whatsapp', sessionId: 'same' });
    const ig = await handleChat(deps, undefined, { message: 'hola', channel: 'instagram', sessionId: 'same' });
    assert.ok(wa.data.build);
    assert.equal(ig.data.build, null);
  });

  it('reset: devuelve reset=true una vez y false despues; el armado vuelve a null', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('a'), say('b')]);
    const deps = chatDeps(env.conversation);
    await handleChat(deps, undefined, { message: 'armar', channel: 'whatsapp', sessionId: 'demo-1' });

    const first = await handleReset(deps, undefined, { channel: 'whatsapp', sessionId: 'demo-1' });
    assert.deepEqual(first.data, { sessionId: 'demo-1', channel: 'whatsapp', reset: true });
    const second = await handleReset(deps, undefined, { channel: 'whatsapp', sessionId: 'demo-1' });
    assert.equal(second.data.reset, false);

    const after = await handleChat(deps, undefined, { message: 'hola', channel: 'whatsapp', sessionId: 'demo-1' });
    assert.equal(after.data.build, null);

    const missing = await rejection(handleReset(deps, undefined, {}));
    assert.equal(missing.code, 'VALIDATION_ERROR');
  });

  it('GET config: indica si hace falta clave y NUNCA la expone', () => {
    const env = setup([]);
    const withKey = getChatConfig(chatDeps(env.conversation, { apiKey: 'secreto-super-largo' }));
    assert.equal(withKey.data.requiresApiKey, true);
    assert.equal(JSON.stringify(withKey).includes('secreto-super-largo'), false);
    const open = getChatConfig(chatDeps(env.conversation, { info: { storeName: 'TECS', mode: 'live', geminiConfigured: false } }));
    assert.deepEqual(open.data, { requiresApiKey: false, storeName: 'TECS', mode: 'live', geminiConfigured: false, maxMessageChars: 1500 });
  });
});

describe('DEMO_ENABLED', () => {
  it('por defecto activo; acepta false; valor invalido -> CONFIG_ERROR', () => {
    assert.equal(loadConfig({}).demoEnabled, true);
    assert.equal(loadConfig({ DEMO_ENABLED: 'false' }).demoEnabled, false);
    assert.equal(loadConfig({ DEMO_ENABLED: '0' }).demoEnabled, false);
    assert.throws(() => loadConfig({ DEMO_ENABLED: 'quizas' }), (error: unknown) => isAppError(error) && error.code === 'CONFIG_ERROR');
  });
});

describe('public/demo/index.html (verificaciones estaticas)', () => {
  const file = path.resolve(__dirname, '../public/demo/index.html');
  const html = fs.readFileSync(file, 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  it('es autocontenido: sin frameworks, CDNs, <script src>, <link rel=stylesheet> ni URLs externas', () => {
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<link[^>]+rel=["']?stylesheet/i);
    assert.doesNotMatch(html, /@import|url\(\s*["']?https?:/i);
    const urls = (html.match(/https?:\/\/[^\s"'<>)]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(urls, []);
  });

  it('el JS compila y no usa APIs peligrosas (eval, innerHTML, document.write)', () => {
    assert.ok(script.length > 1000, 'no se encontro el script integrado');
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'demo-inline.js' }));
    assert.doesNotMatch(script, /\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('todos los ids que usa el JS existen y no hay ids duplicados', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
    assert.equal(new Set(ids).size, ids.length, 'ids duplicados');
    const used = [...script.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1] as string);
    assert.ok(used.length > 15);
    for (const id of used) assert.ok(ids.includes(id), `el JS usa #${id} pero no existe en el HTML`);
  });

  it('cumple los requisitos: canales, sessionId, reset, x-api-key en localStorage y endpoints', () => {
    for (const channel of ['whatsapp', 'instagram', 'mercadolibre']) {
      assert.match(html, new RegExp(`name="channel" id="ch-${channel}" value="${channel}"`));
    }
    assert.match(script, /channel: channel, sessionId: sessionId/);
    assert.match(script, /'x-api-key'/);
    assert.match(script, /localStorage/);
    assert.match(script, /'\.\.\/api\/chat'/);
    assert.match(script, /'\/reset'/);
    assert.match(script, /'\/config'/);
    assert.match(html, /id="newBtn"/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /@media \(max-width: 959px\)/);
    for (const text of ['Quiero armar una PC gamer de $800', '¿Qué cases tienen?', '¿Tienen Ryzen 5 5600G?']) {
      assert.ok(script.includes(text), `falta la prueba rapida: ${text}`);
    }
  });

  it('las categorias del visor coinciden con las del motor de armado', () => {
    const steps = [...script.matchAll(/\['(cpu|motherboard|ram|storage|gpu|psu|case)',/g)].map((m) => m[1]);
    assert.deepEqual(steps, [...BUILD_CATEGORIES]);
  });
});
