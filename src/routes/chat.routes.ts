import crypto from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import type { ConversationService } from '../services/ConversationService';
import type { Channel } from '../types/domain';
import { AppError } from '../utils/errors';
import { isRecord, optEnum, optString, reqString } from '../utils/validators';

export interface ChatDeps {
  conversation: ConversationService;
  /** Si no es null, se exige el encabezado x-api-key. */
  apiKey: string | null;
  exposeDebug: boolean;
}

const CHANNELS: readonly Channel[] = ['web', 'whatsapp', 'instagram', 'mercadolibre'];

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Simulador/demo del asistente sin depender de WhatsApp ni Instagram.
 * Permite probar tambien las politicas de otros canales (ej. channel=mercadolibre).
 */
export function createChatRouter(deps: ChatDeps): Router {
  const router = Router();

  router.post(
    '/api/chat',
    asyncHandler(async (req, res) => {
      if (deps.apiKey !== null) {
        const provided = req.header('x-api-key');
        if (provided === undefined || !safeEqual(provided, deps.apiKey)) {
          throw new AppError('UNAUTHORIZED', 'API key invalida o ausente', 401);
        }
      }
      if (!isRecord(req.body)) {
        throw new AppError('BAD_REQUEST', 'Se esperaba un cuerpo JSON', 400);
      }

      const message = reqString(req.body, 'message', { max: 2000 });
      const channel: Channel = optEnum(req.body, 'channel', CHANNELS) ?? 'web';
      const sessionId = optString(req.body, 'sessionId', { max: 100 }) ?? crypto.randomUUID();

      const result = await deps.conversation.handle({ channel, externalUserId: sessionId, text: message });
      res.json({
        success: true,
        data: {
          sessionId,
          channel,
          reply: result.reply,
          ...(deps.exposeDebug ? { debug: { toolsUsed: result.toolsUsed } } : {}),
        },
      });
    }),
  );

  return router;
}
