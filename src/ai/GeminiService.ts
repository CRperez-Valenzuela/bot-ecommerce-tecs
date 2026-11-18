import type { LlmClient, LlmMessage, LlmPart } from '../types/llm';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import type { Session } from '../services/SessionStore';
import { MAX_PRODUCTS_PER_REPLY } from '../services/curation';
import { trimHistory } from './history';
import { buildSystemPrompt } from './prompt';
import { TOOL_DECLARATIONS } from './tools';
import type { StoreInfo, ToolContext, ToolExecutor } from './ToolExecutor';

export interface GeminiServiceSettings {
  temperature: number;
  maxToolRounds: number;
  maxHistoryTurns: number;
  deliveryEta: string;
}

export interface GeminiServiceDeps {
  /** null cuando no hay GEMINI_API_KEY: el servicio responde LLM_NOT_CONFIGURED. */
  llm: LlmClient | null;
  tools: ToolExecutor;
  store: StoreInfo;
  settings: GeminiServiceSettings;
  log: Logger;
}

export interface ReplyResult {
  text: string;
  toolsUsed: string[];
}

export const FALLBACK_REPLY =
  'Disculpa, tuve un inconveniente para procesar tu mensaje. ¿Podrías repetirlo o darme un poco más de detalle?';

type ToolCallPart = Extract<LlmPart, { kind: 'tool_call' }>;
type TextPart = Extract<LlmPart, { kind: 'text' }>;

const isToolCall = (part: LlmPart): part is ToolCallPart => part.kind === 'tool_call';
const isText = (part: LlmPart): part is TextPart => part.kind === 'text';

/** Orquesta el dialogo con Gemini incluyendo el bucle de Function Calling. */
export class GeminiService {
  constructor(private readonly deps: GeminiServiceDeps) {}

  get configured(): boolean {
    return this.deps.llm !== null;
  }

  async reply(session: Session, userText: string): Promise<ReplyResult> {
    const { llm, tools, store, settings, log } = this.deps;
    if (llm === null) {
      throw new AppError('LLM_NOT_CONFIGURED', 'GEMINI_API_KEY no esta configurada', 503);
    }

    const history = session.history;
    const startLength = history.length;
    history.push({ role: 'user', parts: [{ kind: 'text', text: userText }] });

    const context: ToolContext = {
      session,
      channel: session.channel,
      displayBudget: { remaining: MAX_PRODUCTS_PER_REPLY },
    };
    const toolsUsed: string[] = [];

    try {
      for (let round = 0; round < settings.maxToolRounds; round += 1) {
        const modelMessage = await llm.generate({
          systemInstruction: buildSystemPrompt({
            channel: session.channel,
            store,
            build: session.build,
            deliveryEta: settings.deliveryEta,
          }),
          messages: history,
          tools: TOOL_DECLARATIONS,
          temperature: settings.temperature,
        });

        const calls = modelMessage.parts.filter(isToolCall);
        if (calls.length === 0) {
          const text = modelMessage.parts.filter(isText).map((p) => p.text).join('').trim();
          const finalMessage: LlmMessage =
            text === '' ? { role: 'model', parts: [{ kind: 'text', text: FALLBACK_REPLY }] } : modelMessage;
          history.push(finalMessage);
          session.history = trimHistory(history, settings.maxHistoryTurns);
          return { text: text === '' ? FALLBACK_REPLY : text, toolsUsed };
        }

        history.push(modelMessage);
        const results: LlmPart[] = [];
        for (const call of calls) {
          toolsUsed.push(call.name);
          const response = await tools.execute(call.name, call.args, context);
          results.push({ kind: 'tool_result', id: call.id, name: call.name, response });
        }
        history.push({ role: 'user', parts: results });
      }

      log.warn('Se agotaron las rondas de herramientas sin respuesta final', { session: session.key, toolsUsed });
      history.push({ role: 'model', parts: [{ kind: 'text', text: FALLBACK_REPLY }] });
      session.history = trimHistory(history, settings.maxHistoryTurns);
      return { text: FALLBACK_REPLY, toolsUsed };
    } catch (error) {
      // No dejar el historial a medias (llamadas sin resultado) si algo falla.
      history.length = startLength;
      throw error;
    }
  }
}
