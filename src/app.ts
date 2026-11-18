import type { Express } from 'express';
import express from 'express';
import type { Container } from './container';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { createChatRouter } from './routes/chat.routes';
import { createHealthRouter } from './routes/health.routes';
import type { RawBodyRequest } from './routes/webhooks.routes';
import { createWebhookRouter } from './routes/webhooks.routes';

export function createApp(container: Container): Express {
  const { config, log } = container;
  const app = express();
  app.disable('x-powered-by');

  // Se conserva el cuerpo crudo: la firma de Meta se calcula sobre los bytes originales.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = buffer;
      },
    }),
  );

  app.use(
    createHealthRouter({
      repository: container.repository,
      gemini: container.gemini,
      sessions: container.sessions,
    }),
  );
  app.use(
    createChatRouter({
      conversation: container.conversation,
      apiKey: config.chatApiKey,
      exposeDebug: config.nodeEnv !== 'production',
    }),
  );
  app.use(
    createWebhookRouter({
      dispatcher: container.dispatcher,
      adapters: container.adapters,
      metaAppSecret: config.channels.metaAppSecret,
      production: config.nodeEnv === 'production',
      log: log.child({ component: 'webhooks' }),
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
