import { ChannelDispatcher } from './channels/ChannelDispatcher';
import { InstagramAdapter } from './channels/InstagramAdapter';
import { MercadoLibreAdapter } from './channels/MercadoLibreAdapter';
import { WhatsAppAdapter } from './channels/WhatsAppAdapter';
import type { AppConfig } from './config/env';
import { GeminiService } from './ai/GeminiService';
import { GoogleGenAiClient } from './ai/GoogleGenAiClient';
import { ToolExecutor } from './ai/ToolExecutor';
import type { IInventoryRepository } from './repositories/IInventoryRepository';
import { createRepository } from './repositories';
import { CatalogService } from './services/CatalogService';
import { ConversationService } from './services/ConversationService';
import { PCBuildEngine } from './services/PCBuildEngine';
import { SessionStore } from './services/SessionStore';
import type { LlmClient } from './types/llm';
import type { Logger } from './utils/logger';

export interface Container {
  config: AppConfig;
  repository: IInventoryRepository;
  sessions: SessionStore;
  gemini: GeminiService;
  conversation: ConversationService;
  dispatcher: ChannelDispatcher;
  adapters: {
    whatsapp: WhatsAppAdapter;
    instagram: InstagramAdapter;
    mercadolibre: MercadoLibreAdapter;
  };
  log: Logger;
}

export interface ContainerOverrides {
  repository?: IInventoryRepository;
  llm?: LlmClient | null;
}

/** Composicion de dependencias (unico lugar que conoce las implementaciones concretas). */
export function buildContainer(config: AppConfig, log: Logger, overrides: ContainerOverrides = {}): Container {
  const repository = overrides.repository ?? createRepository(config, log);

  const sessions = new SessionStore({
    ttlMs: config.session.ttlMinutes * 60_000,
    maxSessions: config.session.maxSessions,
  });

  const catalog = new CatalogService(repository);
  const engine = new PCBuildEngine(repository, config.store.deliveryEta);
  const tools = new ToolExecutor({
    catalog,
    engine,
    repo: repository,
    store: config.store,
    log: log.child({ component: 'tools' }),
  });

  const llm: LlmClient | null =
    overrides.llm !== undefined
      ? overrides.llm
      : config.gemini.apiKey !== null
        ? new GoogleGenAiClient({ apiKey: config.gemini.apiKey, model: config.gemini.model })
        : null;
  if (llm === null) log.warn('GEMINI_API_KEY no configurada: el asistente respondera LLM_NOT_CONFIGURED');

  const gemini = new GeminiService({
    llm,
    tools,
    store: config.store,
    settings: {
      temperature: config.gemini.temperature,
      maxToolRounds: config.gemini.maxToolRounds,
      maxHistoryTurns: config.session.maxHistoryTurns,
      deliveryEta: config.store.deliveryEta,
    },
    log: log.child({ component: 'gemini' }),
  });

  const conversation = new ConversationService({
    sessions,
    gemini,
    storeAddress: config.store.address,
    engine,
    log: log.child({ component: 'conversation' }),
  });

  const { channels } = config;
  const adapters = {
    whatsapp: new WhatsAppAdapter({ ...channels.whatsapp, graphVersion: channels.graphVersion }, log.child({ component: 'whatsapp' })),
    instagram: new InstagramAdapter({ ...channels.instagram, graphVersion: channels.graphVersion }, log.child({ component: 'instagram' })),
    mercadolibre: new MercadoLibreAdapter(channels.mercadolibre, log.child({ component: 'mercadolibre' })),
  };

  return {
    config,
    repository,
    sessions,
    gemini,
    conversation,
    dispatcher: new ChannelDispatcher(conversation, log.child({ component: 'dispatcher' })),
    adapters,
    log,
  };
}
