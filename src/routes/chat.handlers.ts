import crypto from 'node:crypto';
import type { ConversationService } from '../services/ConversationService';
import type { PCBuildView } from '../services/PCBuildEngine';
import type { ApiSuccessResponse } from '../types/api';
import type { Channel, OdooMode } from '../types/domain';
import { AppError } from '../utils/errors';
import { isRecord, optEnum, optString, reqString } from '../utils/validators';

/** Datos informativos que expone GET /api/chat/config (nunca secretos). */
export interface ChatInfo {
  storeName: string;
  mode: OdooMode;
  geminiConfigured: boolean;
}

export interface ChatDeps {
  conversation: ConversationService;
  /** Si no es null, se exige el encabezado x-api-key. */
  apiKey: string | null;
  exposeDebug: boolean;
  info: ChatInfo;
}

export interface ChatData {
  sessionId: string;
  channel: Channel;
  reply: string;
  /** Estado del armado de PC de la sesion (null si aun no hay armado en curso). */
  build: PCBuildView | null;
  debug?: { toolsUsed: string[] };
}

export interface ResetData {
  sessionId: string;
  channel: Channel;
  /** false si la sesion no existia (p. ej. ya expiro). */
  reset: boolean;
}

export interface ChatConfigData {
  requiresApiKey: boolean;
  storeName: string;
  mode: OdooMode;
  geminiConfigured: boolean;
  maxMessageChars: number;
}

export const CHAT_CHANNELS: readonly Channel[] = ['web', 'whatsapp', 'instagram', 'mercadolibre'];
export const MAX_MESSAGE_CHARS = 1500;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Lanza UNAUTHORIZED si el servidor exige clave y la recibida no coincide. */
export function assertChatAuthorized(deps: Pick<ChatDeps, 'apiKey'>, providedKey: string | undefined): void {
  if (deps.apiKey === null) return;
  if (providedKey === undefined || !safeEqual(providedKey, deps.apiKey)) {
    throw new AppError('UNAUTHORIZED', 'API key invalida o ausente', 401);
  }
}

function asBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new AppError('BAD_REQUEST', 'Se esperaba un cuerpo JSON', 400);
  return body;
}

export async function handleChat(
  deps: ChatDeps,
  providedKey: string | undefined,
  rawBody: unknown,
): Promise<ApiSuccessResponse<ChatData>> {
  assertChatAuthorized(deps, providedKey);
  const body = asBody(rawBody);

  const message = reqString(body, 'message', { max: 2000 });
  const channel: Channel = optEnum(body, 'channel', CHAT_CHANNELS) ?? 'web';
  const sessionId = optString(body, 'sessionId', { max: 100 }) ?? crypto.randomUUID();

  const result = await deps.conversation.handle({ channel, externalUserId: sessionId, text: message });
  return {
    success: true,
    data: {
      sessionId,
      channel,
      reply: result.reply,
      build: result.build,
      ...(deps.exposeDebug ? { debug: { toolsUsed: result.toolsUsed } } : {}),
    },
  };
}

/** Reinicia el estado en memoria (historial + armado) de una sesion del simulador. */
export async function handleReset(
  deps: ChatDeps,
  providedKey: string | undefined,
  rawBody: unknown,
): Promise<ApiSuccessResponse<ResetData>> {
  assertChatAuthorized(deps, providedKey);
  const body = asBody(rawBody);

  const sessionId = reqString(body, 'sessionId', { max: 100 });
  const channel: Channel = optEnum(body, 'channel', CHAT_CHANNELS) ?? 'web';
  const reset = await deps.conversation.reset(channel, sessionId);
  return { success: true, data: { sessionId, channel, reset } };
}

export function getChatConfig(deps: ChatDeps): ApiSuccessResponse<ChatConfigData> {
  return {
    success: true,
    data: {
      requiresApiKey: deps.apiKey !== null,
      storeName: deps.info.storeName,
      mode: deps.info.mode,
      geminiConfigured: deps.info.geminiConfigured,
      maxMessageChars: MAX_MESSAGE_CHARS,
    },
  };
}
