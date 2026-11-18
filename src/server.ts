import { createApp } from './app';
import { loadConfig, loadDotEnv } from './config/env';
import { buildContainer } from './container';
import { isAppError } from './utils/errors';
import { createFileLogSink } from './utils/fileLogSink';
import { createLogger } from './utils/logger';
import type { LogSink } from './utils/logger';

function main(): void {
  loadDotEnv();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // El logger aun no existe: se informa por consola y se aborta.
    if (isAppError(error)) {
      console.error(JSON.stringify({ level: 'error', message: error.message, details: error.details }));
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  let sink: LogSink | undefined;
  let sinkError: unknown;
  if (config.logging.dir !== null) {
    try {
      sink = createFileLogSink({ dir: config.logging.dir, retentionDays: config.logging.retentionDays });
    } catch (error) {
      // Sin carpeta de logs el servicio debe seguir atendiendo: queda solo la salida estandar.
      sinkError = error;
    }
  }
  const log = createLogger(config.logLevel, { service: 'bot-ecommerce-tecs' }, sink);
  if (sinkError !== undefined) log.error('LOG_DIR no se pudo preparar: se registra solo en la salida estandar', { dir: config.logging.dir, error: sinkError });
  const container = buildContainer(config, log);
  container.sessions.startSweeper();

  if (config.nodeEnv === 'production' && config.chatApiKey === null) {
    log.warn('CHAT_API_KEY no configurada: POST /api/chat queda abierto al publico (defínela o bloquea la ruta en el proxy)');
  }

  const app = createApp(container);
  const server = app.listen(config.port, () => {
    log.info('Servidor iniciado', {
      port: config.port,
      odooMode: config.odooMode,
      env: config.nodeEnv,
      rateLimit: config.rateLimit.enabled ? `${config.rateLimit.max} por ${config.rateLimit.windowSeconds}s por IP` : 'desactivado',
      logDir: config.logging.dir,
      ...(config.demoEnabled ? { demo: `http://localhost:${config.port}/demo/` } : {}),
    });
  });

  const shutdown = (signal: string): void => {
    log.info('Apagando servidor', { signal });
    container.sessions.stopSweeper();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('Promesa rechazada sin manejar', { reason });
  });
}

main();
