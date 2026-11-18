import path from 'node:path';
import type { Express } from 'express';
import express from 'express';
import type { Container } from './container';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { RateLimiter, createRateLimitMiddleware } from './middleware/rateLimit';
import { createChatRouter } from './routes/chat.routes';
import { createHealthRouter } from './routes/health.routes';
import type { RawBodyRequest } from './routes/webhooks.routes';
import { createWebhookRouter } from './routes/webhooks.routes';

export interface AppOptions {
  /** Carpeta con los archivos estaticos (public/demo/...). Por defecto: <raiz del proyecto>/public. */
  publicDir?: string;
}

/** Cabeceras del simulador: la pagina es autocontenida, asi que se prohibe cargar o conectar con terceros. */
const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function createApp(container: Container, options: AppOptions = {}): Express {
  const { config, log } = container;
  const app = express();
  app.disable('x-powered-by');
  // Solo con proxy inverso declarado se confia en X-Forwarded-For; si no, un cliente podria falsear su IP.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  // Se conserva el cuerpo crudo: la firma de Meta se calcula sobre los bytes originales.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = buffer;
      },
    }),
  );

  if (config.demoEnabled) {
    // __dirname es src/ (tsx) o dist/ (compilado): en ambos casos public/ queda un nivel arriba.
    const publicDir = options.publicDir ?? path.resolve(__dirname, '..', 'public');
    app.use(
      '/demo',
      express.static(path.join(publicDir, 'demo'), {
        index: 'index.html',
        maxAge: 0,
        setHeaders: (res) => {
          res.setHeader('Content-Security-Policy', DEMO_CSP);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Referrer-Policy', 'no-referrer');
          res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  app.use(
    createHealthRouter({
      repository: container.repository,
      gemini: container.gemini,
      sessions: container.sessions,
    }),
  );
  const chatRateLimit = config.rateLimit.enabled
    ? createRateLimitMiddleware(
        new RateLimiter({ max: config.rateLimit.max, windowMs: config.rateLimit.windowSeconds * 1000 }),
        { windowSeconds: config.rateLimit.windowSeconds, log: log.child({ component: 'rate-limit' }) },
      )
    : undefined;

  app.use(
    createChatRouter(
      {
        conversation: container.conversation,
        apiKey: config.chatApiKey,
        exposeDebug: config.nodeEnv !== 'production',
        info: {
          storeName: config.store.name,
          mode: config.odooMode,
          geminiConfigured: container.gemini.configured,
        },
      },
      { rateLimit: chatRateLimit },
    ),
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
