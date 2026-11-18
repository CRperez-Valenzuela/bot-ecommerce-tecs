import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import { FALLBACK_REPLY, GeminiService } from '../src/ai/GeminiService';
import { trimHistory } from '../src/ai/history';
import { buildSystemPrompt } from '../src/ai/prompt';
import type { ToolContext } from '../src/ai/ToolExecutor';
import { ToolExecutor } from '../src/ai/ToolExecutor';
import { TOOL_DECLARATIONS, TOOL_NAMES } from '../src/ai/tools';
import { CatalogService } from '../src/services/CatalogService';
import { ConversationService } from '../src/services/ConversationService';
import { MAX_PRODUCTS_PER_REPLY } from '../src/services/curation';
import { PCBuildEngine, createEmptyBuild } from '../src/services/PCBuildEngine';
import { SessionStore } from '../src/services/SessionStore';
import type { LlmClient, LlmGenerateRequest, LlmMessage } from '../src/types/llm';
import type { Channel } from '../src/types/domain';
import { AppError, isAppError } from '../src/utils/errors';
import { silentLogger } from '../src/utils/logger';
import { makeMockRepo } from './helpers/fixtures';

const STORE = { name: 'TECS', city: 'Acarigua, Portuguesa', address: 'Av. Principal, C.C. Ejemplo, Local 5', hours: 'Lun-Sab 9am-6pm' };
const SETTINGS = { temperature: 0.4, maxToolRounds: 4, maxHistoryTurns: 14, deliveryEta: '24 a 48 horas hábiles' };

const call = (name: string, args: Record<string, unknown>, id = `call-${name}`): LlmMessage => ({
  role: 'model',
  parts: [{ kind: 'tool_call', id, name, args, thoughtSignature: 'sig-abc' }],
});
const say = (text: string): LlmMessage => ({ role: 'model', parts: [{ kind: 'text', text }] });

/** LLM guionado: cada llamada consume el siguiente paso y registra la peticion recibida. */
class ScriptedLlm implements LlmClient {
  readonly requests: LlmGenerateRequest[] = [];
  constructor(private readonly script: (LlmMessage | Error)[]) {}

  async generate(request: LlmGenerateRequest): Promise<LlmMessage> {
    this.requests.push({ ...request, messages: structuredClone(request.messages) });
    const step = this.script.shift();
    if (step === undefined) throw new Error('guion agotado');
    if (step instanceof Error) throw step;
    return step;
  }
}

function setup(script: (LlmMessage | Error)[]) {
  const temp = makeMockRepo();
  const sessions = new SessionStore({ ttlMs: 60_000, maxSessions: 100 });
  const engine = new PCBuildEngine(temp.repo, SETTINGS.deliveryEta);
  const tools = new ToolExecutor({ catalog: new CatalogService(temp.repo), engine, repo: temp.repo, store: STORE, log: silentLogger });
  const llm = new ScriptedLlm(script);
  const gemini = new GeminiService({ llm, tools, store: STORE, settings: SETTINGS, log: silentLogger });
  const conversation = new ConversationService({ sessions, gemini, storeAddress: STORE.address, log: silentLogger });
  return { temp, sessions, tools, llm, gemini, conversation, engine };
}

function ctxFor(sessions: SessionStore, channel: Channel = 'whatsapp'): ToolContext {
  return { session: sessions.getOrCreate(`${channel}:u1`, channel), channel, displayBudget: { remaining: MAX_PRODUCTS_PER_REPLY } };
}

describe('declaraciones de herramientas', () => {
  it('cada herramienta tiene nombre unico, handler y esquema coherente', () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual([...names].sort(), Object.values(TOOL_NAMES).sort());
    for (const tool of TOOL_DECLARATIONS) {
      for (const required of tool.parameters?.required ?? []) {
        assert.ok(tool.parameters?.properties[required], `${tool.name}.${required} no declarado`);
      }
    }
  });
});

describe('ToolExecutor', () => {
  const instances: ReturnType<typeof setup>[] = [];
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup([]);
    instances.push(env);
  });
  after(() => instances.forEach((i) => i.temp.cleanup()));

  it('consulta vaga -> error NEEDS_CLARIFICATION con preguntas, sin productos', async () => {
    const result = await env.tools.execute(TOOL_NAMES.searchProducts, { categoria: 'case' }, ctxFor(env.sessions));
    assert.equal(result.ok, false);
    const error = result.error as { code: string; details: { preguntas_sugeridas: string[] } };
    assert.equal(error.code, 'NEEDS_CLARIFICATION');
    assert.ok(error.details.preguntas_sugeridas.length >= 1 && error.details.preguntas_sugeridas.length <= 2);
    assert.equal('products' in result, false);
  });

  it('TOPE EN CODIGO: tras mostrar 3 opciones, nuevas busquedas devuelven DISPLAY_LIMIT_REACHED', async () => {
    const ctx = ctxFor(env.sessions);
    const first = await env.tools.execute(TOOL_NAMES.searchProducts, { categoria: 'case', presupuesto_max_usd: 150, preferencia: 'gamer' }, ctx);
    assert.equal(first.ok, true);
    assert.equal((first.products as unknown[]).length, 3);
    assert.equal(ctx.displayBudget.remaining, 0);
    const second = await env.tools.execute(TOOL_NAMES.searchProducts, { categoria: 'cpu', presupuesto_max_usd: 150 }, ctx);
    assert.equal(second.ok, false);
    assert.equal((second.error as { code: string }).code, 'DISPLAY_LIMIT_REACHED');
  });

  it('consultar_producto agotado: producto + max 2 alternativas, nunca mas de 3 en total', async () => {
    const result = await env.tools.execute(TOOL_NAMES.lookupProduct, { texto: 'Ryzen 7 5700X' }, ctxFor(env.sessions));
    assert.equal(result.ok, true);
    assert.equal(result.available, false);
    assert.ok((result.alternatives as unknown[]).length <= 2);
    assert.match(String(result.note), /AGOTADO/);
  });

  it('valida argumentos y nunca lanza: devuelve error estructurado', async () => {
    const ctx = ctxFor(env.sessions);
    const bad = await env.tools.execute(TOOL_NAMES.searchProducts, { categoria: 'monitor' }, ctx);
    assert.equal((bad.error as { code: string }).code, 'VALIDATION_ERROR');
    const unknown = await env.tools.execute('hackear_sistema', {}, ctx);
    assert.equal((unknown.error as { code: string }).code, 'NOT_FOUND');
    const noSku = await env.tools.execute(TOOL_NAMES.selectComponent, {}, ctx);
    assert.equal((noSku.error as { code: string }).code, 'VALIDATION_ERROR');
  });

  it('registrar_visita: bloqueado en Mercado Libre', async () => {
    const result = await env.tools.execute(
      TOOL_NAMES.registerVisit,
      { nombre_cliente: 'Ana', telefono: '0414-1234567' },
      ctxFor(env.sessions, 'mercadolibre'),
    );
    assert.equal((result.error as { code: string }).code, 'CHANNEL_RESTRICTED');
    assert.equal(fs.existsSync(env.temp.leadsPath), false);
  });

  it('registrar_visita: valida telefono y, con armado completo, guarda el lead con cotizacion', async () => {
    const ctx = ctxFor(env.sessions);
    const invalid = await env.tools.execute(TOOL_NAMES.registerVisit, { nombre_cliente: 'Ana', telefono: 'abc' }, ctx);
    assert.equal((invalid.error as { code: string }).code, 'VALIDATION_ERROR');

    env.engine.start(ctx.session.build, { purpose: 'gaming', budgetUsd: 800 });
    for (const sku of ['CPU-R5-5600', 'MB-B550M-PRO-VDH', 'RAM-KF-16-D4', 'SSD-SN580-1T', 'GPU-RTX4060-8G', 'PSU-CV650', 'CASE-CM-Q300LV2']) {
      await env.engine.select(ctx.session.build, sku);
    }
    const ok = await env.tools.execute(
      TOOL_NAMES.registerVisit,
      { nombre_cliente: 'Ana Pérez', telefono: '+58 414 1234567', fecha_preferida: 'sábado por la tarde' },
      ctx,
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.includesQuote, true);
    assert.deepEqual(ok.store, { name: 'TECS', city: STORE.city, address: STORE.address, hours: STORE.hours });
    const leads = JSON.parse(fs.readFileSync(env.temp.leadsPath, 'utf8')) as { customerName: string; quote: { totalUsd: number } }[];
    assert.equal(leads[0]?.customerName, 'Ana Pérez');
    assert.equal(leads[0]?.quote.totalUsd, 108 + 108 + 44 + 68 + 305 + 68 + 52 + 50);
    assert.equal(ctx.session.customer.name, 'Ana Pérez');
  });
});

describe('GeminiService - bucle de Function Calling', () => {
  const instances: ReturnType<typeof setup>[] = [];
  after(() => instances.forEach((i) => i.temp.cleanup()));
  const make = (script: (LlmMessage | Error)[]) => {
    const env = setup(script);
    instances.push(env);
    return env;
  };

  it('ejecuta la herramienta, devuelve el resultado al modelo y conserva firmas e ids', async () => {
    const env = make([
      call(TOOL_NAMES.searchProducts, { categoria: 'case', presupuesto_max_usd: 60, preferencia: 'gamer' }),
      say('Te recomiendo el Antec NX200M.'),
    ]);
    const result = await env.conversation.handle({ channel: 'whatsapp', externalUserId: '58414', text: 'Busco un case gamer de hasta 60 dolares' });
    assert.equal(result.reply, 'Te recomiendo el Antec NX200M.');
    assert.deepEqual(result.toolsUsed, [TOOL_NAMES.searchProducts]);

    // 2da peticion: incluye la llamada (con firma) y su resultado (con id)
    const second = env.llm.requests[1];
    assert.ok(second);
    const modelTurn = second.messages.at(-2);
    const toolTurn = second.messages.at(-1);
    assert.equal(modelTurn?.parts[0]?.kind === 'tool_call' && modelTurn.parts[0].thoughtSignature, 'sig-abc');
    const part = toolTurn?.parts[0];
    assert.ok(part && part.kind === 'tool_result');
    assert.equal(part.id, `call-${TOOL_NAMES.searchProducts}`);
    assert.equal(part.response.ok, true);

    // Historial: usuario, llamada, resultado, respuesta
    const session = env.sessions.peek('whatsapp:58414');
    assert.deepEqual(session?.history.map((m) => m.role), ['user', 'model', 'user', 'model']);
  });

  it('el prompt se reconstruye con el estado del armado y el canal', async () => {
    const env = make([
      call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 700 }),
      call(TOOL_NAMES.selectComponent, { sku: 'CPU-R5-5600' }),
      say('Listo.'),
    ]);
    await env.conversation.handle({ channel: 'instagram', externalUserId: 'ig1', text: 'Quiero armar una PC gamer de 700' });
    const last = env.llm.requests.at(-1)?.systemInstruction ?? '';
    assert.match(last, /Proposito: gaming \| Presupuesto: \$700/);
    assert.match(last, /cpu: AMD Ryzen 5 5600/);
    assert.match(last, /CANAL: INSTAGRAM/);
  });

  it('LLM falla -> el historial vuelve a su estado previo y el error se propaga', async () => {
    const env = make([say('Hola'), call(TOOL_NAMES.lookupProduct, { texto: 'RTX 4060' }), new Error('503 upstream')]);
    await env.conversation.handle({ channel: 'web', externalUserId: 's1', text: 'Hola' });
    const before = env.sessions.peek('web:s1')?.history.length;
    await assert.rejects(() => env.conversation.handle({ channel: 'web', externalUserId: 's1', text: 'Precio de la RTX 4060?' }), /503/);
    assert.equal(env.sessions.peek('web:s1')?.history.length, before);
  });

  it('si se agotan las rondas de herramientas responde con un mensaje seguro', async () => {
    const loop = Array.from({ length: SETTINGS.maxToolRounds }, (_, i) => call(TOOL_NAMES.viewBuild, {}, `c${i}`));
    const env = make(loop);
    const result = await env.conversation.handle({ channel: 'web', externalUserId: 's2', text: 'resumen' });
    assert.equal(result.reply, FALLBACK_REPLY);
    assert.equal(env.sessions.peek('web:s2')?.history.at(-1)?.role, 'model');
  });

  it('respuesta vacia del modelo -> mensaje de respaldo', async () => {
    const env = make([{ role: 'model', parts: [] }]);
    const result = await env.conversation.handle({ channel: 'web', externalUserId: 's3', text: 'hola' });
    assert.equal(result.reply, FALLBACK_REPLY);
  });

  it('sin GEMINI_API_KEY -> LLM_NOT_CONFIGURED (503)', async () => {
    const temp = makeMockRepo();
    instances.push({ temp } as ReturnType<typeof setup>);
    const sessions = new SessionStore({ ttlMs: 1000, maxSessions: 10 });
    const engine = new PCBuildEngine(temp.repo, 'x');
    const tools = new ToolExecutor({ catalog: new CatalogService(temp.repo), engine, repo: temp.repo, store: STORE, log: silentLogger });
    const gemini = new GeminiService({ llm: null, tools, store: STORE, settings: SETTINGS, log: silentLogger });
    assert.equal(gemini.configured, false);
    await assert.rejects(
      () => gemini.reply(sessions.getOrCreate('web:x', 'web'), 'hola'),
      (error: unknown) => isAppError(error) && error.code === 'LLM_NOT_CONFIGURED' && error.httpStatus === 503,
    );
  });

  it('Mercado Libre: elimina telefono, enlaces y direccion aunque el modelo los escriba', async () => {
    const dirty =
      'Claro, esta disponible. Escribenos al 0414-1234567, visita https://tecs.example.com o ven a Av. Principal, C.C. Ejemplo, Local 5. IG: @tecs_acarigua';
    const env = make([say(dirty)]);
    const result = await env.conversation.handle({ channel: 'mercadolibre', externalUserId: 'buyer:MLV1', text: 'Tienen stock?' });
    assert.doesNotMatch(result.reply, /0414|https?:|tecs\.example|Av\. Principal|@tecs/i);
    assert.match(result.reply, /disponible/);
  });

  it('WhatsApp: convierte **negrita** de markdown a *negrita*', async () => {
    const env = make([say('El total es **$420**')]);
    const result = await env.conversation.handle({ channel: 'whatsapp', externalUserId: 'w1', text: 'total?' });
    assert.equal(result.reply, 'El total es *$420*');
  });

  it('serializa mensajes concurrentes de la misma sesion', async () => {
    const env = make([say('uno'), say('dos')]);
    const [a, b] = await Promise.all([
      env.conversation.handle({ channel: 'web', externalUserId: 'same', text: 'a' }),
      env.conversation.handle({ channel: 'web', externalUserId: 'same', text: 'b' }),
    ]);
    assert.deepEqual([a.reply, b.reply], ['uno', 'dos']);
    assert.deepEqual(env.sessions.peek('web:same')?.history.map((m) => m.role), ['user', 'model', 'user', 'model']);
  });

  it('rechaza mensajes vacios y recorta los demasiado largos', async () => {
    const env = make([say('ok')]);
    await assert.rejects(
      () => env.conversation.handle({ channel: 'web', externalUserId: 'e', text: '   ' }),
      (error: unknown) => error instanceof AppError && error.code === 'BAD_REQUEST',
    );
    await env.conversation.handle({ channel: 'web', externalUserId: 'e', text: 'x'.repeat(5000) });
    const stored = env.sessions.peek('web:e')?.history[0]?.parts[0];
    assert.ok(stored?.kind === 'text' && stored.text.length === 1500);
  });
});

describe('prompt del sistema y recorte de historial', () => {
  const baseBuild = createEmptyBuild();

  it('Mercado Libre prohibe telefonos, direcciones, enlaces y no usa registrar_visita', () => {
    const prompt = buildSystemPrompt({ channel: 'mercadolibre', store: STORE, build: baseBuild, deliveryEta: 'x' });
    assert.match(prompt, /PROHIBIDO/);
    assert.match(prompt, /telefono/i);
    assert.match(prompt, /direcciones exactas/i);
    assert.match(prompt, /enlaces/i);
  });

  it('incluye las reglas de curaduria: max 3 opciones y desambiguacion', () => {
    const prompt = buildSystemPrompt({ channel: 'whatsapp', store: STORE, build: baseBuild, deliveryEta: '24 a 48 horas' });
    assert.match(prompt, /nunca muestres mas de 3 opciones/i);
    assert.match(prompt, /1 o 2 preguntas cerradas/);
    assert.match(prompt, /24 a 48 horas/);
  });

  it('trimHistory corta solo en inicio de turno (nunca deja una llamada sin su resultado)', () => {
    const user = (t: string): LlmMessage => ({ role: 'user', parts: [{ kind: 'text', text: t }] });
    const result: LlmMessage = { role: 'user', parts: [{ kind: 'tool_result', name: 'x', response: {} }] };
    const history: LlmMessage[] = [user('1'), say('a'), user('2'), call('x', {}), result, say('b'), user('3'), say('c')];
    const trimmed = trimHistory(history, 2);
    assert.equal(trimmed[0]?.role, 'user');
    assert.deepEqual(trimmed.map((m) => m.parts[0]?.kind), ['text', 'tool_call', 'tool_result', 'text', 'text', 'text']);
    assert.equal(trimHistory(history, 10), history);
  });
});
