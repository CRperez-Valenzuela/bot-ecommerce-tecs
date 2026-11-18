import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ChannelDispatcher } from '../channels/ChannelDispatcher';
import { verifyMetaSignature } from '../channels/metaSignature';
import type { IChannelAdapter } from '../channels/types';
import type { InstagramAdapter } from '../channels/InstagramAdapter';
import type { MercadoLibreAdapter } from '../channels/MercadoLibreAdapter';
import type { WhatsAppAdapter } from '../channels/WhatsAppAdapter';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export interface WebhookDeps {
  dispatcher: ChannelDispatcher;
  adapters: {
    whatsapp: WhatsAppAdapter;
    instagram: InstagramAdapter;
    mercadolibre: MercadoLibreAdapter;
  };
  /** Secreto de la app de Meta para validar X-Hub-Signature-256. */
  metaAppSecret: string | null;
  production: boolean;
  log: Logger;
}

function queryValue(req: Request, key: string): string {
  const value = req.query[key];
  return typeof value === 'string' ? value : '';
}

/** Verificacion inicial del webhook de Meta (suscripcion). */
function handleMetaVerification(req: Request, res: Response, expectedToken: string): void {
  const mode = queryValue(req, 'hub.mode');
  const token = queryValue(req, 'hub.verify_token');
  const challenge = queryValue(req, 'hub.challenge');
  if (mode === 'subscribe' && expectedToken !== '' && token === expectedToken) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  throw new AppError('FORBIDDEN', 'Token de verificacion invalido', 403);
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();
  const { dispatcher, adapters, log } = deps;

  const requireMetaSignature = (req: RawBodyRequest): void => {
    if (deps.metaAppSecret === null) {
      if (deps.production) {
        throw new AppError('UNAUTHORIZED', 'META_APP_SECRET es obligatorio en produccion', 401);
      }
      log.warn('META_APP_SECRET no configurado: firma del webhook sin validar (solo desarrollo)');
      return;
    }
    if (!verifyMetaSignature(req.rawBody, req.header('x-hub-signature-256'), deps.metaAppSecret)) {
      throw new AppError('UNAUTHORIZED', 'Firma del webhook invalida', 401);
    }
  };

  const receiveMeta = (adapter: IChannelAdapter) =>
    asyncHandler(async (req, res) => {
      requireMetaSignature(req as RawBodyRequest);
      const messages = await adapter.receive(req.body);
      // Meta exige 200 rapido: la conversacion se procesa en segundo plano.
      res.status(200).json({ success: true, data: { received: messages.length } });
      dispatcher.dispatch(adapter, messages);
    });

  router.get('/webhooks/whatsapp', (req, res) => handleMetaVerification(req, res, adapters.whatsapp.verifyToken));
  router.post('/webhooks/whatsapp', receiveMeta(adapters.whatsapp));

  router.get('/webhooks/instagram', (req, res) => handleMetaVerification(req, res, adapters.instagram.verifyToken));
  router.post('/webhooks/instagram', receiveMeta(adapters.instagram));

  // Mercado Libre no firma las notificaciones: se valida el user_id del vendedor.
  router.post(
    '/webhooks/mercadolibre',
    asyncHandler(async (req, res) => {
      if (!adapters.mercadolibre.isForSeller(req.body)) {
        throw new AppError('FORBIDDEN', 'Notificacion dirigida a otro vendedor', 403);
      }
      // Se responde 200 de inmediato; leer la pregunta puede tardar y ML reintenta si no hay respuesta rapida.
      res.status(200).json({ success: true, data: { received: true } });
      void adapters.mercadolibre
        .receive(req.body)
        .then((messages) => dispatcher.dispatch(adapters.mercadolibre, messages))
        .catch((error: unknown) => {
          log.error('No se pudo procesar la notificacion de Mercado Libre', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }),
  );

  return router;
}
