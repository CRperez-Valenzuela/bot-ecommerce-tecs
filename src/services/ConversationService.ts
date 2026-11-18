import { enforceChannelOutput } from '../ai/replyGuard';
import type { GeminiService } from '../ai/GeminiService';
import type { Channel } from '../types/domain';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import type { SessionStore } from './SessionStore';

export interface ConversationInput {
  channel: Channel;
  externalUserId: string;
  text: string;
}

export interface ConversationResult {
  sessionKey: string;
  reply: string;
  toolsUsed: string[];
}

export interface ConversationDeps {
  sessions: SessionStore;
  gemini: GeminiService;
  storeAddress: string;
  log: Logger;
  maxInputChars?: number;
}

/** Punto unico de entrada de mensajes: sesion -> Gemini -> politicas del canal. */
export class ConversationService {
  private readonly maxInputChars: number;

  constructor(private readonly deps: ConversationDeps) {
    this.maxInputChars = deps.maxInputChars ?? 1500;
  }

  async handle(input: ConversationInput): Promise<ConversationResult> {
    const text = input.text.trim();
    if (text === '') {
      throw new AppError('BAD_REQUEST', 'El mensaje esta vacio', 400);
    }
    const externalUserId = input.externalUserId.trim();
    if (externalUserId === '') {
      throw new AppError('BAD_REQUEST', 'Falta el identificador del usuario', 400);
    }

    const sessionKey = `${input.channel}:${externalUserId}`;
    const { sessions, gemini, storeAddress, log } = this.deps;

    return sessions.runExclusive(sessionKey, async () => {
      const session = sessions.getOrCreate(sessionKey, input.channel);
      const result = await gemini.reply(session, text.slice(0, this.maxInputChars));

      const guarded = enforceChannelOutput(input.channel, result.text, { storeAddress });
      if (guarded.modified && input.channel === 'mercadolibre') {
        log.warn('Se elimino contenido prohibido de una respuesta de Mercado Libre', { session: sessionKey });
      }
      log.info('Mensaje atendido', {
        session: sessionKey,
        channel: input.channel,
        tools: result.toolsUsed,
      });
      return { sessionKey, reply: guarded.text, toolsUsed: result.toolsUsed };
    });
  }
}
