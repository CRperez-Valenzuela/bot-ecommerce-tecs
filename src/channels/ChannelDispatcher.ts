import type { ConversationService } from '../services/ConversationService';
import type { Logger } from '../utils/logger';
import { errorMessage } from '../utils/errors';
import type { RateLimiter } from '../middleware/rateLimit';
import { SeenCache } from './SeenCache';
import type { IChannelAdapter, InboundMessage } from './types';

const UNSUPPORTED_REPLY = 'Por ahora solo puedo leer mensajes de texto. ¿Me cuentas por escrito qué estás buscando?';
const THROTTLED_REPLY = 'Estás escribiendo muy rápido y no alcanzo a leerte con calma. Dame un momento y vuelve a escribirme, por favor.';
const ERROR_REPLY = 'Disculpa, tuve un inconveniente técnico. ¿Podrías escribirme de nuevo en un momento?';

export interface DispatcherOptions {
  /** Espera tras el ultimo mensaje de un cliente antes de responder, para juntar ráfagas en una sola consulta (0 = sin agrupar). */
  debounceMs?: number;
  /** Tope de espera desde el primer mensaje de la ráfaga. */
  maxWaitMs?: number;
  /** Mensajes por ráfaga que fuerzan la respuesta inmediata. */
  maxBatch?: number;
  /** Limite de mensajes por cliente (clave canal:usuario). null = sin limite. */
  userRateLimiter?: RateLimiter | null;
}

interface Batch {
  adapter: IChannelAdapter;
  messages: InboundMessage[];
  firstAt: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Procesa mensajes recibidos por webhook fuera del ciclo de la peticion HTTP
 * (los canales exigen responder 200 rapido): deduplica, limita por cliente, agrupa ráfagas,
 * conversa y envia la respuesta. Mercado Libre nunca se agrupa: cada pregunta publica se responde por separado.
 */
export class ChannelDispatcher {
  private readonly pending = new Map<string, Batch>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly maxBatch: number;
  private readonly userLimiter: RateLimiter | null;

  constructor(
    private readonly conversation: ConversationService,
    private readonly log: Logger,
    private readonly seen: SeenCache = new SeenCache(),
    options: DispatcherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 0;
    this.maxWaitMs = options.maxWaitMs ?? 8000;
    this.maxBatch = options.maxBatch ?? 10;
    this.userLimiter = options.userRateLimiter ?? null;
  }

  /** Lanza el procesamiento sin esperar. Los errores se registran y nunca escapan. */
  dispatch(adapter: IChannelAdapter, messages: InboundMessage[]): void {
    for (const message of messages) {
      void this.accept(adapter, message).catch((error: unknown) => {
        this.log.error('Fallo el procesamiento del mensaje', {
          channel: message.channel,
          error: errorMessage(error),
        });
      });
    }
  }

  /** Mensajes de clientes esperando a que termine su ráfaga. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Responde ya todo lo pendiente (apagado ordenado y pruebas). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((key) => this.flush(key)));
  }

  /** Procesa un mensaje de inmediato: deduplica y conversa (sin limite por cliente ni agrupacion). */
  async process(adapter: IChannelAdapter, message: InboundMessage): Promise<void> {
    if (this.isDuplicate(message)) return;
    await this.handle(adapter, message);
  }

  private isDuplicate(message: InboundMessage): boolean {
    if (message.messageId !== null && this.seen.seen(`${message.channel}:${message.messageId}`)) {
      this.log.debug('Mensaje duplicado ignorado', { channel: message.channel });
      return true;
    }
    return false;
  }

  private async accept(adapter: IChannelAdapter, message: InboundMessage): Promise<void> {
    if (this.isDuplicate(message)) return;

    if (this.userLimiter !== null) {
      const verdict = this.userLimiter.hit(`${message.channel}:${message.externalUserId}`);
      if (!verdict.allowed) {
        if (verdict.firstBlock) {
          this.log.warn('Cliente superó el límite de mensajes', { channel: message.channel, limit: verdict.limit });
          // Un aviso en Mercado Libre seria publico: ahi solo se descarta.
          if (message.channel !== 'mercadolibre') await this.safeSend(adapter, message, THROTTLED_REPLY);
        }
        return;
      }
    }

    if (message.kind === 'text' && this.debounceMs > 0 && message.channel !== 'mercadolibre') {
      this.enqueue(adapter, message);
      return;
    }
    await this.handle(adapter, message);
  }

  private enqueue(adapter: IChannelAdapter, message: InboundMessage): void {
    const key = `${message.channel}:${message.externalUserId}`;
    const now = Date.now();
    let batch = this.pending.get(key);
    if (batch === undefined) {
      batch = { adapter, messages: [], firstAt: now, timer: null };
      this.pending.set(key, batch);
    }
    batch.messages.push(message);
    if (batch.timer !== null) clearTimeout(batch.timer);

    const wait = batch.messages.length >= this.maxBatch ? 0 : Math.max(0, Math.min(this.debounceMs, batch.firstAt + this.maxWaitMs - now));
    batch.timer = setTimeout(() => {
      void this.flush(key).catch((error: unknown) => {
        this.log.error('Fallo el procesamiento del mensaje', { channel: message.channel, error: errorMessage(error) });
      });
    }, wait);
  }

  private async flush(key: string): Promise<void> {
    const batch = this.pending.get(key);
    if (batch === undefined) return;
    this.pending.delete(key);
    if (batch.timer !== null) clearTimeout(batch.timer);

    const last = batch.messages[batch.messages.length - 1];
    if (last === undefined) return;
    if (batch.messages.length > 1) {
      this.log.info('Mensajes agrupados en una sola consulta', { channel: last.channel, count: batch.messages.length });
    }
    const merged: InboundMessage = { ...last, text: batch.messages.map((m) => m.text.trim()).filter((t) => t !== '').join('\n') };
    await this.handle(batch.adapter, merged);
  }

  private async safeSend(adapter: IChannelAdapter, message: InboundMessage, text: string): Promise<void> {
    try {
      await adapter.sendText(message, text);
    } catch (error) {
      this.log.error('No se pudo enviar el aviso', { channel: message.channel, error: errorMessage(error) });
    }
  }

  private async handle(adapter: IChannelAdapter, message: InboundMessage): Promise<void> {
    if (message.kind === 'unsupported') {
      // Mercado Libre solo recibe preguntas de texto; no aplica.
      if (message.channel !== 'mercadolibre') await adapter.sendText(message, UNSUPPORTED_REPLY);
      return;
    }

    try {
      const result = await this.conversation.handle({
        channel: message.channel,
        externalUserId: message.externalUserId,
        text: message.text,
      });
      await adapter.sendText(message, result.reply);
    } catch (error) {
      this.log.error('No se pudo responder al cliente', { channel: message.channel, error: errorMessage(error) });
      // En Mercado Libre una respuesta de error seria publica: se deja la pregunta sin responder.
      if (message.channel === 'mercadolibre') return;
      try {
        await adapter.sendText(message, ERROR_REPLY);
      } catch (sendError) {
        this.log.error('Tampoco se pudo enviar el aviso de error', { error: errorMessage(sendError) });
      }
    }
  }
}
