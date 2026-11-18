import type { RequestHandler, Response } from 'express';
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { getChatConfig, handleChat, handleReset } from './chat.handlers';
import type { ChatDeps } from './chat.handlers';

export type { ChatDeps } from './chat.handlers';

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * Simulador/demo del asistente sin depender de WhatsApp ni Instagram.
 * Permite probar tambien las politicas de otros canales (ej. channel=mercadolibre).
 * La logica vive en chat.handlers.ts (funciones puras, sin Express) para poder probarla.
 */
export interface ChatRouterOptions {
  /** Se ejecuta ANTES de autenticar y de llamar a Gemini (tambien frena intentos de adivinar la clave). */
  rateLimit?: RequestHandler;
}

export function createChatRouter(deps: ChatDeps, options: ChatRouterOptions = {}): Router {
  const router = Router();
  const limit: RequestHandler[] = options.rateLimit ? [options.rateLimit] : [];

  // Publico a proposito: solo indica si hace falta clave (el simulador decide si abre el modal).
  router.get('/api/chat/config', (_req, res) => {
    noStore(res);
    res.json(getChatConfig(deps));
  });

  router.post(
    '/api/chat',
    ...limit,
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await handleChat(deps, req.header('x-api-key'), req.body as unknown));
    }),
  );

  router.post(
    '/api/chat/reset',
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await handleReset(deps, req.header('x-api-key'), req.body as unknown));
    }),
  );

  return router;
}
