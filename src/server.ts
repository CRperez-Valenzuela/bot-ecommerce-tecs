import { createApp } from './app';
import { loadConfig, loadDotEnv } from './config/env';
import { buildContainer } from './container';
import { isAppError } from './utils/errors';
import { createLogger } from './utils/logger';

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

  const log = createLogger(config.logLevel, { service: 'bot-ecommerce-tecs' });
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
