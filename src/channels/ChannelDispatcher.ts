import type { ConversationService } from '../services/ConversationService';
import type { Logger } from '../utils/logger';
import { errorMessage } from '../utils/errors';
import { SeenCache } from './SeenCache';
import type { IChannelAdapter, InboundMessage } from './types';

const UNSUPPORTED_REPLY = 'Por ahora solo puedo leer mensajes de texto. ¿Me cuentas por escrito qué estás buscando?';
const ERROR_REPLY = 'Disculpa, tuve un inconveniente técnico. ¿Podrías escribirme de nuevo en un momento?';

/**
 * Procesa mensajes recibidos por webhook fuera del ciclo de la peticion HTTP
 * (los canales exigen responder 200 rapido): deduplica, conversa y envia la respuesta.
 */
export class ChannelDispatcher {
  constructor(
    private readonly conversation: ConversationService,
    private readonly log: Logger,
    private readonly seen: SeenCache = new SeenCache(),
  ) {}

  /** Lanza el procesamiento sin esperar. Los errores se registran y nunca escapan. */
  dispatch(adapter: IChannelAdapter, messages: InboundMessage[]): void {
    for (const message of messages) {
      void this.process(adapter, message).catch((error: unknown) => {
        this.log.error('Fallo el procesamiento del mensaje', {
          channel: message.channel,
          error: errorMessage(error),
        });
      });
    }
  }

  async process(adapter: IChannelAdapter, message: InboundMessage): Promise<void> {
    if (message.messageId !== null && this.seen.seen(`${message.channel}:${message.messageId}`)) {
      this.log.debug('Mensaje duplicado ignorado', { channel: message.channel });
      return;
    }

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
