import { enforceChannelOutput } from '../ai/replyGuard';
import type { GeminiService } from '../ai/GeminiService';
import type { Channel } from '../types/domain';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import type { PCBuildEngine, PCBuildView } from './PCBuildEngine';
import type { Session, SessionStore } from './SessionStore';

export interface ConversationInput {
  channel: Channel;
  externalUserId: string;
  text: string;
}

export interface ConversationResult {
  sessionKey: string;
  reply: string;
  toolsUsed: string[];
  /** Estado actual del armado de PC de la sesion (null si no hay armado en curso o no hay motor). */
  build: PCBuildView | null;
}

export interface ConversationDeps {
  sessions: SessionStore;
  gemini: GeminiService;
  storeAddress: string;
  log: Logger;
  /** Opcional: si se entrega, cada respuesta incluye la vista del armado (simulador/panel). */
  engine?: PCBuildEngine;
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
      const build = await this.describeBuild(session.build, sessionKey);
      return { sessionKey, reply: guarded.text, toolsUsed: result.toolsUsed, build };
    });
  }

  /** Descarta la sesion (historial + armado en memoria). Devuelve true si existia. */
  async reset(channel: Channel, externalUserId: string): Promise<boolean> {
    const id = externalUserId.trim();
    if (id === '') {
      throw new AppError('BAD_REQUEST', 'Falta el identificador del usuario', 400);
    }
    const sessionKey = `${channel}:${id}`;
    return this.deps.sessions.runExclusive(sessionKey, async () => this.deps.sessions.delete(sessionKey));
  }

  /** La vista es informativa: un fallo al calcularla nunca debe tumbar la respuesta al cliente. */
  private async describeBuild(state: Session['build'], sessionKey: string): Promise<PCBuildView | null> {
    const { engine, log } = this.deps;
    if (engine === undefined) return null;
    try {
      return await engine.view(state);
    } catch (error) {
      log.warn('No se pudo calcular la vista del armado', { session: sessionKey, error });
      return null;
    }
  }
}
