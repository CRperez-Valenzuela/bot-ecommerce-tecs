import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enforceChannelOutput, sanitizeForMercadoLibre } from '../src/ai/replyGuard';
import { ChannelDispatcher } from '../src/channels/ChannelDispatcher';
import type { HttpFn, HttpRequestInit, HttpResult } from '../src/channels/http';
import { parseInstagramPayload, InstagramAdapter } from '../src/channels/InstagramAdapter';
import { MercadoLibreAdapter } from '../src/channels/MercadoLibreAdapter';
import { computeMetaSignature, verifyMetaSignature } from '../src/channels/metaSignature';
import { SeenCache } from '../src/channels/SeenCache';
import type { InboundMessage } from '../src/channels/types';
import { WhatsAppAdapter, parseWhatsAppPayload } from '../src/channels/WhatsAppAdapter';
import type { ConversationService } from '../src/services/ConversationService';
import { chunkText } from '../src/utils/text';
import { silentLogger } from '../src/utils/logger';

describe('replyGuard - Mercado Libre', () => {
  const cases: [string, string][] = [
    ['Llamanos al 0414-1234567 para mas info', '0414'],
    ['Escribe al +58 424 555 66 77', '555'],
    ['Mira https://www.tecs.com.ve/producto/123', 'https'],
    ['Visita www.tecs.com.ve', 'tecs.com'],
    ['tecsacarigua.com tiene mas', 'tecsacarigua'],
    ['Escribeme a ventas@tecs.com.ve', '@tecs'],
    ['Siguenos en @tecs_acarigua', '@tecs'],
    ['Estamos en la Avenida 5 con Calle 12 de Acarigua', 'Avenida'],
    ['Ven al Centro Comercial Ejemplo Local 4', 'Centro Comercial'],
  ];
  for (const [input, forbidden] of cases) {
    it(`elimina: ${input}`, () => {
      const { text, modified } = sanitizeForMercadoLibre(input);
      assert.equal(modified, true);
      assert.ok(!text.toLowerCase().includes(forbidden.toLowerCase()), `quedo "${forbidden}" en: ${text}`);
    });
  }

  it('elimina la direccion exacta configurada', () => {
    const { text } = sanitizeForMercadoLibre('Estamos en Urb. Los Samanes, Torre B piso 2.', {
      storeAddress: 'Urb. Los Samanes, Torre B piso 2',
    });
    assert.doesNotMatch(text, /Samanes/);
  });

  it('NO toca precios, especificaciones ni texto comercial legitimo', () => {
    const safe = 'La RTX 4060 8GB cuesta $305, trae 128 bits y 3072 nucleos. Memoria 3200 MHz, 16GB. Garantia de 12 meses.';
    const { text, modified } = sanitizeForMercadoLibre(safe);
    assert.equal(modified, false);
    assert.equal(text, safe);
  });

  it('en otros canales no elimina nada (WhatsApp puede compartir contacto)', () => {
    const msg = 'Escribenos al 0414-1234567';
    assert.equal(enforceChannelOutput('whatsapp', msg).text, msg);
    assert.equal(enforceChannelOutput('instagram', 'Hola **mundo**').text, 'Hola mundo');
  });

  it('quita encabezados markdown', () => {
    assert.equal(enforceChannelOutput('whatsapp', '## Resumen\nTotal $10').text, 'Resumen\nTotal $10');
  });
});

describe('firma de Meta y deduplicacion', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = 'app-secret';

  it('acepta la firma correcta y rechaza alteraciones', () => {
    const header = computeMetaSignature(body, secret);
    assert.equal(verifyMetaSignature(body, header, secret), true);
    assert.equal(verifyMetaSignature(Buffer.from('{"x":1}'), header, secret), false);
    assert.equal(verifyMetaSignature(body, header, 'otro'), false);
    assert.equal(verifyMetaSignature(body, undefined, secret), false);
    assert.equal(verifyMetaSignature(body, 'sha1=abc', secret), false);
    assert.equal(verifyMetaSignature(undefined, header, secret), false);
  });

  it('SeenCache detecta duplicados y respeta el TTL', () => {
    let now = 0;
    const cache = new SeenCache(1000, 100, () => now);
    assert.equal(cache.seen('a'), false);
    assert.equal(cache.seen('a'), true);
    now = 1500;
    assert.equal(cache.seen('a'), false);
  });
});

describe('parseo de webhooks', () => {
  it('WhatsApp: texto, no-texto y contacto', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Ana' }, wa_id: '58414' }],
                messages: [
                  { id: 'wamid.1', from: '58414', timestamp: '1760000000', type: 'text', text: { body: 'Hola' } },
                  { id: 'wamid.2', from: '58414', type: 'image', image: { id: 'x' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWhatsAppPayload(payload);
    assert.equal(messages.length, 2);
    assert.deepEqual(
      messages.map((m) => [m.kind, m.text, m.externalUserId]),
      [['text', 'Hola', '58414'], ['unsupported', '', '58414']],
    );
    assert.equal(messages[0]?.metadata.contactName, 'Ana');
    assert.deepEqual(parseWhatsAppPayload({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), []);
    assert.deepEqual(parseWhatsAppPayload('basura'), []);
    assert.deepEqual(parseWhatsAppPayload(null), []);
  });

  it('Instagram: ignora ecos propios y mensajes sin remitente', () => {
    const payload = {
      entry: [
        {
          messaging: [
            { sender: { id: 'u1' }, message: { mid: 'm1', text: 'Hola' } },
            { sender: { id: 'u1' }, message: { mid: 'm2', text: 'eco', is_echo: true } },
            { sender: { id: 'u2' }, message: { mid: 'm3', attachments: [{}] } },
            { message: { mid: 'm4', text: 'sin remitente' } },
          ],
        },
      ],
    };
    const messages = parseInstagramPayload(payload);
    assert.deepEqual(messages.map((m) => [m.externalUserId, m.kind]), [['u1', 'text'], ['u2', 'unsupported']]);
  });
});

/** Cliente HTTP falso que registra llamadas y responde segun una tabla. */
function fakeHttp(routes: Record<string, (init: HttpRequestInit) => HttpResult>): { http: HttpFn; calls: { url: string; init: HttpRequestInit }[] } {
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const http: HttpFn = async (url, init) => {
    calls.push({ url, init });
    const handler = routes[`${init.method} ${new URL(url).pathname}`];
    return handler ? handler(init) : { status: 404, ok: false, json: null };
  };
  return { http, calls };
}
const ok = (json: unknown): HttpResult => ({ status: 200, ok: true, json });

describe('adaptadores de envio', () => {
  const inbound = (channel: InboundMessage['channel'], extra: Partial<InboundMessage> = {}): InboundMessage => ({
    channel,
    externalUserId: 'u1',
    text: 'hola',
    kind: 'text',
    messageId: null,
    metadata: {},
    receivedAt: new Date().toISOString(),
    ...extra,
  });

  it('WhatsApp envia a la Graph API con bearer y parte mensajes largos', async () => {
    const { http, calls } = fakeHttp({ 'POST /v23.0/123/messages': () => ok({}) });
    const adapter = new WhatsAppAdapter({ phoneNumberId: '123', accessToken: 'tok', verifyToken: 'v', graphVersion: 'v23.0' }, silentLogger, http);
    await adapter.sendText(inbound('whatsapp', { externalUserId: '58414' }), 'x'.repeat(5000));
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.init.headers?.Authorization, 'Bearer tok');
    const sent = JSON.parse(calls[0]?.init.body ?? '{}') as { to: string; messaging_product: string };
    assert.equal(sent.to, '58414');
    assert.equal(sent.messaging_product, 'whatsapp');
  });

  it('WhatsApp sin credenciales no envia ni falla; con rechazo lanza CHANNEL_ERROR', async () => {
    const none = fakeHttp({});
    const unconfigured = new WhatsAppAdapter({ phoneNumberId: '', accessToken: '', verifyToken: '', graphVersion: 'v23.0' }, silentLogger, none.http);
    assert.equal(unconfigured.isConfigured(), false);
    await unconfigured.sendText(inbound('whatsapp'), 'hola');
    assert.equal(none.calls.length, 0);

    const rejecting = fakeHttp({ 'POST /v23.0/1/messages': () => ({ status: 400, ok: false, json: { error: 'x' } }) });
    const adapter = new WhatsAppAdapter({ phoneNumberId: '1', accessToken: 't', verifyToken: '', graphVersion: 'v23.0' }, silentLogger, rejecting.http);
    await assert.rejects(() => adapter.sendText(inbound('whatsapp'), 'hola'), /rechazo/);
  });

  it('Instagram envia al destinatario correcto en trozos <= 800', async () => {
    const { http, calls } = fakeHttp({ 'POST /v23.0/me/messages': () => ok({}) });
    const adapter = new InstagramAdapter({ accessToken: 't', verifyToken: 'v', graphVersion: 'v23.0' }, silentLogger, http);
    await adapter.sendText(inbound('instagram', { externalUserId: 'igsid' }), 'palabra '.repeat(300));
    assert.ok(calls.length >= 3);
    for (const c of calls) {
      const body = JSON.parse(c.init.body ?? '{}') as { recipient: { id: string }; message: { text: string } };
      assert.equal(body.recipient.id, 'igsid');
      assert.ok(body.message.text.length <= 800);
    }
  });

  it('chunkText nunca supera el maximo y no pierde contenido', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Parrafo ${i} ${'palabra '.repeat(30)}`).join('\n\n');
    const chunks = chunkText(text, 500);
    assert.ok(chunks.every((c) => c.length <= 500));
    assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
  });
});

describe('MercadoLibreAdapter', () => {
  const config = { accessToken: 'old', refreshToken: 'r1', clientId: 'cid', clientSecret: 'sec', sellerId: '999' };
  const question = { id: 555, status: 'UNANSWERED', text: 'Tienen la RTX 4060?', from: { id: 321 }, item_id: 'MLV123' };

  it('lee la pregunta + contexto de la publicacion y la normaliza', async () => {
    const { http } = fakeHttp({
      'GET /questions/555': () => ok(question),
      'GET /items/MLV123': () => ok({ title: 'MSI RTX 4060', price: 305, currency_id: 'USD' }),
    });
    const adapter = new MercadoLibreAdapter(config, silentLogger, http);
    const [message] = await adapter.receive({ topic: 'questions', resource: '/questions/555', user_id: 999 });
    assert.ok(message);
    assert.equal(message.channel, 'mercadolibre');
    assert.equal(message.externalUserId, '321:MLV123');
    assert.equal(message.metadata.questionId, '555');
    assert.match(message.text, /MSI RTX 4060/);
    assert.match(message.text, /Tienen la RTX 4060\?/);
  });

  it('ignora otros topics, recursos raros, otros vendedores, preguntas ya respondidas y propias', async () => {
    const answered = fakeHttp({ 'GET /questions/555': () => ok({ ...question, status: 'ANSWERED' }) });
    const adapter = new MercadoLibreAdapter(config, silentLogger, answered.http);
    assert.deepEqual(await adapter.receive({ topic: 'orders_v2', resource: '/orders/1', user_id: 999 }), []);
    assert.deepEqual(await adapter.receive({ topic: 'questions', resource: '/questions/abc', user_id: 999 }), []);
    assert.deepEqual(await adapter.receive({ topic: 'questions', resource: '/questions/555', user_id: 1 }), []);
    assert.deepEqual(await adapter.receive({ topic: 'questions', resource: '/questions/555', user_id: 999 }), []);
    const own = fakeHttp({ 'GET /questions/555': () => ok({ ...question, from: { id: 999 } }) });
    assert.deepEqual(await new MercadoLibreAdapter(config, silentLogger, own.http).receive({ topic: 'questions', resource: '/questions/555', user_id: 999 }), []);
  });

  it('responde via POST /answers (max 2000) y renueva el token ante 401', async () => {
    let attempts = 0;
    const { http, calls } = fakeHttp({
      'POST /answers': (init) => {
        attempts += 1;
        return init.headers?.Authorization === 'Bearer new' ? ok({ id: 1 }) : { status: 401, ok: false, json: null };
      },
      'POST /oauth/token': () => ok({ access_token: 'new', refresh_token: 'r2' }),
    });
    const adapter = new MercadoLibreAdapter(config, silentLogger, http);
    const message: InboundMessage = {
      channel: 'mercadolibre',
      externalUserId: '321:MLV123',
      text: 'x',
      kind: 'text',
      messageId: 'm',
      metadata: { questionId: '555' },
      receivedAt: '',
    };
    await adapter.sendText(message, 'a'.repeat(3000));
    assert.equal(attempts, 2);
    const answer = JSON.parse(calls.find((c) => c.url.endsWith('/answers'))?.init.body ?? '{}') as { question_id: number; text: string };
    assert.equal(answer.question_id, 555);
    assert.ok(answer.text.length <= 2000);
    const refresh = calls.find((c) => c.url.endsWith('/oauth/token'));
    assert.match(refresh?.init.body ?? '', /grant_type=refresh_token/);
  });
});

describe('ChannelDispatcher', () => {
  const message = (extra: Partial<InboundMessage>): InboundMessage => ({
    channel: 'whatsapp',
    externalUserId: 'u',
    text: 'hola',
    kind: 'text',
    messageId: 'id-1',
    metadata: {},
    receivedAt: '',
    ...extra,
  });
  const sent: string[] = [];
  const adapter = {
    channel: 'whatsapp' as const,
    isConfigured: () => true,
    receive: async () => [],
    sendText: async (_m: InboundMessage, text: string) => void sent.push(text),
  };

  it('deduplica reintentos, contesta adjuntos sin LLM y avisa si falla la conversacion', async () => {
    sent.length = 0;
    let handled = 0;
    const conversation = { handle: async () => { handled += 1; return { sessionKey: 'k', reply: 'respuesta', toolsUsed: [] }; } } as unknown as ConversationService;
    const dispatcher = new ChannelDispatcher(conversation, silentLogger);

    await dispatcher.process(adapter, message({}));
    await dispatcher.process(adapter, message({})); // mismo messageId
    assert.equal(handled, 1);
    assert.deepEqual(sent, ['respuesta']);

    await dispatcher.process(adapter, message({ messageId: 'id-2', kind: 'unsupported', text: '' }));
    assert.match(sent.at(-1) ?? '', /solo puedo leer mensajes de texto/);
    assert.equal(handled, 1);

    const failing = { handle: async () => { throw new Error('boom'); } } as unknown as ConversationService;
    await new ChannelDispatcher(failing, silentLogger).process(adapter, message({ messageId: 'id-3' }));
    assert.match(sent.at(-1) ?? '', /inconveniente/);
  });

  it('en Mercado Libre una falla NO publica un mensaje de error', async () => {
    sent.length = 0;
    const failing = { handle: async () => { throw new Error('boom'); } } as unknown as ConversationService;
    const mlAdapter = { ...adapter, channel: 'mercadolibre' as const };
    await new ChannelDispatcher(failing, silentLogger).process(mlAdapter, message({ channel: 'mercadolibre', messageId: 'ml-1' }));
    assert.deepEqual(sent, []);
  });
});
