import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RequestScheduler } from '../src/ai/RequestScheduler';
import { GoogleGenAiClient } from '../src/ai/GoogleGenAiClient';
import type { GenAiLike } from '../src/ai/GoogleGenAiClient';
import { ChannelDispatcher } from '../src/channels/ChannelDispatcher';
import type { IChannelAdapter, InboundMessage } from '../src/channels/types';
import { loadConfig } from '../src/config/env';
import { RateLimiter } from '../src/middleware/rateLimit';
import type { ConversationService } from '../src/services/ConversationService';
import { isAppError } from '../src/utils/errors';
import { createLogger } from '../src/utils/logger';

const silent = createLogger('error', {}, { write: () => undefined });
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function harness(options: ConstructorParameters<typeof ChannelDispatcher>[3]) {
  const handled: Array<{ channel: string; user: string; text: string }> = [];
  const sent: string[] = [];
  const conversation = {
    handle: async (input: { channel: string; externalUserId: string; text: string }) => {
      handled.push({ channel: input.channel, user: input.externalUserId, text: input.text });
      return { sessionKey: 'k', reply: `re:${input.text}`, toolsUsed: [] };
    },
  } as unknown as ConversationService;
  const adapter = (channel: 'whatsapp' | 'instagram' | 'mercadolibre' = 'whatsapp'): IChannelAdapter => ({
    channel,
    isConfigured: () => true,
    receive: async () => [],
    sendText: async (_m, text) => void sent.push(text),
  });
  const dispatcher = new ChannelDispatcher(conversation, silent, undefined, options);
  let counter = 0;
  const msg = (text: string, extra: Partial<InboundMessage> = {}): InboundMessage => ({
    channel: 'whatsapp',
    externalUserId: 'u1',
    text,
    kind: 'text',
    messageId: `m${(counter += 1)}`,
    metadata: {},
    receivedAt: '',
    ...extra,
  });
  return { dispatcher, handled, sent, adapter, msg };
}

describe('ChannelDispatcher: agrupar rafagas', () => {
  it('3 mensajes seguidos del mismo cliente => una sola consulta y una sola respuesta', async () => {
    const { dispatcher, handled, sent, adapter, msg } = harness({ debounceMs: 40, maxWaitMs: 1000 });
    const wa = adapter();
    dispatcher.dispatch(wa, [msg('hola'), msg('busco una pc')]);
    await sleep(15);
    dispatcher.dispatch(wa, [msg('para jugar')]);
    assert.equal(handled.length, 0);
    assert.equal(dispatcher.pendingCount, 1);
    await sleep(120);
    assert.equal(handled.length, 1);
    assert.equal(handled[0]?.text, 'hola\nbusco una pc\npara jugar');
    assert.deepEqual(sent, ['re:hola\nbusco una pc\npara jugar']);
    assert.equal(dispatcher.pendingCount, 0);
  });

  it('clientes distintos no se mezclan', async () => {
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 30 });
    dispatcher.dispatch(adapter(), [msg('a', { externalUserId: 'u1' }), msg('b', { externalUserId: 'u2' })]);
    await sleep(100);
    assert.deepEqual(handled.map((h) => [h.user, h.text]).sort(), [['u1', 'a'], ['u2', 'b']]);
  });

  it('el tope de espera responde aunque el cliente siga escribiendo', async () => {
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 60, maxWaitMs: 100 });
    const wa = adapter();
    for (let i = 0; i < 5; i += 1) {
      dispatcher.dispatch(wa, [msg(`m${i}`)]);
      await sleep(40);
    }
    assert.ok(handled.length >= 1, 'debio responder antes de que el cliente dejara de escribir');
    await dispatcher.flushAll();
    await sleep(20);
  });

  it('maxBatch fuerza la respuesta inmediata', async () => {
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 5000, maxBatch: 3 });
    dispatcher.dispatch(adapter(), [msg('1'), msg('2'), msg('3')]);
    await sleep(40);
    assert.equal(handled.length, 1);
    assert.equal(handled[0]?.text, '1\n2\n3');
  });

  it('Mercado Libre y adjuntos nunca se agrupan; con debounce 0 cada mensaje va solo', async () => {
    const ml = harness({ debounceMs: 200 });
    ml.dispatcher.dispatch(ml.adapter('mercadolibre'), [ml.msg('p1', { channel: 'mercadolibre' }), ml.msg('p2', { channel: 'mercadolibre' })]);
    await sleep(30);
    assert.deepEqual(ml.handled.map((h) => h.text), ['p1', 'p2']);

    const media = harness({ debounceMs: 200 });
    media.dispatcher.dispatch(media.adapter(), [media.msg('', { kind: 'unsupported' })]);
    await sleep(30);
    assert.match(media.sent[0] ?? '', /solo puedo leer mensajes de texto/);
    assert.equal(media.dispatcher.pendingCount, 0);

    const off = harness({ debounceMs: 0 });
    off.dispatcher.dispatch(off.adapter(), [off.msg('x'), off.msg('y')]);
    await sleep(30);
    assert.deepEqual(off.handled.map((h) => h.text), ['x', 'y']);
  });

  it('descarta duplicados de Meta (mismo messageId) antes de agrupar', async () => {
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 30 });
    const dup = msg('hola', { messageId: 'igual' });
    dispatcher.dispatch(adapter(), [dup, { ...dup }]);
    await sleep(100);
    assert.equal(handled[0]?.text, 'hola');
  });

  it('flushAll responde lo pendiente (apagado ordenado)', async () => {
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 10_000 });
    dispatcher.dispatch(adapter(), [msg('pendiente')]);
    await sleep(10);
    assert.equal(handled.length, 0);
    await dispatcher.flushAll();
    assert.equal(handled.length, 1);
    assert.equal(dispatcher.pendingCount, 0);
  });
});

describe('ChannelDispatcher: limite por cliente', () => {
  it('al pasar el limite avisa una sola vez y descarta el resto sin llamar a Gemini', async () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 60_000 });
    const { dispatcher, handled, sent, adapter, msg } = harness({ debounceMs: 0, userRateLimiter: limiter });
    dispatcher.dispatch(adapter(), Array.from({ length: 8 }, (_, i) => msg(`m${i}`)));
    await sleep(50);
    assert.equal(handled.length, 3);
    assert.equal(sent.filter((t) => t.includes('muy rápido')).length, 1);
    // otro cliente no se ve afectado
    dispatcher.dispatch(adapter(), [msg('otro', { externalUserId: 'u2' })]);
    await sleep(30);
    assert.equal(handled.length, 4);
  });

  it('en Mercado Libre se descarta sin publicar ningun aviso', async () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 60_000 });
    const { dispatcher, handled, sent, adapter, msg } = harness({ userRateLimiter: limiter });
    dispatcher.dispatch(adapter('mercadolibre'), [msg('a', { channel: 'mercadolibre' }), msg('b', { channel: 'mercadolibre' })]);
    await sleep(40);
    assert.equal(handled.length, 1);
    assert.deepEqual(sent, ['re:a']);
  });

  it('los mensajes agrupados cuentan uno a uno contra el limite', async () => {
    const limiter = new RateLimiter({ max: 2, windowMs: 60_000 });
    const { dispatcher, handled, adapter, msg } = harness({ debounceMs: 30, userRateLimiter: limiter });
    dispatcher.dispatch(adapter(), [msg('1'), msg('2'), msg('3')]);
    await sleep(100);
    assert.equal(handled[0]?.text, '1\n2');
  });
});

describe('RequestScheduler', () => {
  it('limita la concurrencia y respeta el orden de llegada', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 2, maxPerWindow: 0, queueMaxWaitMs: 5000 });
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const job = (n: number) => scheduler.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(n);
      await sleep(20);
      active -= 1;
      return n;
    });
    const results = await Promise.all([1, 2, 3, 4, 5].map(job));
    assert.deepEqual(results, [1, 2, 3, 4, 5]);
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
    assert.equal(peak, 2);
  });

  it('limita las llamadas por ventana (RPM) retrasandolas, sin descartarlas', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 0, maxPerWindow: 2, windowMs: 120, queueMaxWaitMs: 5000 });
    const startedAt: number[] = [];
    const t0 = Date.now();
    await Promise.all([1, 2, 3, 4].map(() => scheduler.run(async () => void startedAt.push(Date.now() - t0))));
    assert.equal(startedAt.length, 4);
    assert.ok((startedAt[0] ?? 999) < 60 && (startedAt[1] ?? 999) < 60);
    assert.ok((startedAt[2] ?? 0) >= 110, `la 3a debio esperar la ventana (${startedAt[2]} ms)`);
    assert.ok((startedAt[3] ?? 0) >= 110);
  });

  it('una llamada que espera demasiado en cola falla con LLM_UNAVAILABLE', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1, maxPerWindow: 0, queueMaxWaitMs: 40 });
    const slow = scheduler.run(() => sleep(120));
    await assert.rejects(scheduler.run(async () => 'x'), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.equal(error.httpStatus, 503);
      return true;
    });
    await slow;
    assert.equal(scheduler.queued, 0);
  });

  it('sin limites ejecuta directamente y un fallo de una tarea libera su lugar', async () => {
    assert.equal(await new RequestScheduler({ maxConcurrent: 0, maxPerWindow: 0, queueMaxWaitMs: 1000 }).run(async () => 7), 7);
    const scheduler = new RequestScheduler({ maxConcurrent: 1, maxPerWindow: 0, queueMaxWaitMs: 1000 });
    await assert.rejects(scheduler.run(async () => { throw new Error('boom'); }));
    assert.equal(await scheduler.run(async () => 'ok'), 'ok');
  });
});

describe('GoogleGenAiClient + cola', () => {
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

  it('maxConcurrent limita las llamadas simultaneas reales al SDK', async () => {
    let active = 0;
    let peak = 0;
    const sdk: GenAiLike = {
      models: {
        generateContent: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(15);
          active -= 1;
          return okResponse;
        },
      },
    };
    const client = new GoogleGenAiClient({ apiKey: 'AQ.x', model: 'm', maxConcurrent: 2, sdk });
    await Promise.all(Array.from({ length: 6 }, () => client.generate(request)));
    assert.equal(peak, 2);
  });

  it('la espera en cola no cuenta para el tiempo maximo por intento', async () => {
    const sdk: GenAiLike = { models: { generateContent: async () => { await sleep(30); return okResponse; } } };
    const client = new GoogleGenAiClient({ apiKey: 'AQ.x', model: 'm', maxConcurrent: 1, requestTimeoutMs: 1000, sdk });
    await Promise.all([client.generate(request), client.generate(request), client.generate(request)]);
  });

  it('un tiempo de cola agotado llega como LLM_UNAVAILABLE (no se disfraza de LLM_ERROR)', async () => {
    const sdk: GenAiLike = { models: { generateContent: async () => { await sleep(150); return okResponse; } } };
    const client = new GoogleGenAiClient({ apiKey: 'AQ.x', model: 'm', maxConcurrent: 1, queueMaxWaitMs: 1000, sdk });
    // queueMaxWaitMs minimo de la config es 1000; aqui se fuerza un valor menor directamente.
    const tight = new GoogleGenAiClient({ apiKey: 'AQ.x', model: 'm', maxConcurrent: 1, queueMaxWaitMs: 30, sdk });
    const first = tight.generate(request);
    await assert.rejects(tight.generate(request), (error: unknown) => isAppError(error) && error.code === 'LLM_UNAVAILABLE' && (error.details as { reason: string }).reason === 'queue-timeout');
    await first;
    await client.generate(request);
  });
});

describe('configuracion del control de flujo', () => {
  it('valores por defecto y validacion', () => {
    const config = loadConfig({});
    assert.deepEqual(config.messaging, { debounceMs: 2500, debounceMaxWaitMs: 8000, userRate: { enabled: true, max: 10, windowSeconds: 60 } });
    assert.deepEqual([config.gemini.maxRequestsPerMinute, config.gemini.maxConcurrent, config.gemini.queueMaxWaitMs], [0, 4, 30000]);

    const custom = loadConfig({ MESSAGE_DEBOUNCE_MS: '0', GEMINI_MAX_RPM: '5', GEMINI_MAX_CONCURRENT: '0', WEBHOOK_USER_RATE_MAX: '3', RATE_LIMIT_ENABLED: 'false' });
    assert.equal(custom.messaging.debounceMs, 0);
    assert.equal(custom.messaging.userRate.enabled, false);
    assert.equal(custom.gemini.maxRequestsPerMinute, 5);
    assert.throws(() => loadConfig({ MESSAGE_DEBOUNCE_MS: '99999' }));
    assert.throws(() => loadConfig({ GEMINI_MAX_CONCURRENT: '1000' }));
  });
});
