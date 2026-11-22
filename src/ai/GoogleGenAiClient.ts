import { GoogleGenAI, Type } from '@google/genai';
import type { Content, FunctionDeclaration, GenerateContentResponse, Part, Schema } from '@google/genai';
import type { LlmClient, LlmGenerateRequest, LlmMessage, LlmPart, ToolDeclaration, ToolParamSchema } from '../types/llm';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { truncate } from '../utils/text';

/** Parte del SDK que se usa; permite inyectar un doble en las pruebas. */
export interface GenAiLike {
  models: { generateContent(params: Parameters<GoogleGenAI['models']['generateContent']>[0]): Promise<GenerateContentResponse> };
}

export interface GoogleGenAiOptions {
  apiKey: string;
  model: string;
  /** Reintentos ante 429/500/502/503/504 (alta demanda temporal de Gemini). Por defecto 3. */
  maxRetries?: number;
  /** Espera base del retroceso exponencial en ms (1000, 2000, 4000... con tope de 8000 y algo de azar). Por defecto 1000. */
  retryBaseMs?: number;
  /** Modelo alternativo que se prueba una vez agotados los reintentos de un error de servidor (no con 429). */
  fallbackModel?: string | null;
  log?: Logger;
  /** Solo para pruebas: sustituyen al SDK real, a la espera y al azar. */
  sdk?: GenAiLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const TYPE_MAP: Record<ToolParamSchema['type'], Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
};

function toSchema(param: ToolParamSchema): Schema {
  const schema: Schema = { type: TYPE_MAP[param.type], description: param.description };
  if (param.enum !== undefined) schema.enum = [...param.enum];
  return schema;
}

function toDeclaration(tool: ToolDeclaration): FunctionDeclaration {
  if (tool.parameters === undefined) return { name: tool.name, description: tool.description };
  const properties: Record<string, Schema> = {};
  for (const [name, param] of Object.entries(tool.parameters.properties)) properties[name] = toSchema(param);
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties,
      required: tool.parameters.required ? [...tool.parameters.required] : [],
    },
  };
}

function toPart(part: LlmPart): Part {
  switch (part.kind) {
    case 'text':
      return part.thoughtSignature ? { text: part.text, thoughtSignature: part.thoughtSignature } : { text: part.text };
    case 'tool_call':
      return {
        functionCall: { id: part.id, name: part.name, args: part.args },
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      };
    case 'tool_result':
      return { functionResponse: { id: part.id, name: part.name, response: part.response } };
  }
}

function toContent(message: LlmMessage): Content {
  return { role: message.role, parts: message.parts.map(toPart) };
}

function fromResponse(response: GenerateContentResponse): LlmMessage {
  const parts: LlmPart[] = [];
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.functionCall?.name) {
      parts.push({
        kind: 'tool_call',
        id: part.functionCall.id,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        thoughtSignature: part.thoughtSignature,
      });
    } else if (typeof part.text === 'string' && part.text !== '' && part.thought !== true) {
      parts.push({ kind: 'text', text: part.text, thoughtSignature: part.thoughtSignature });
    }
  }
  return { role: 'model', parts };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

const SERVER_FAILURE = new Set([500, 502, 503, 504]);
const RETRYABLE = new Set([429, ...SERVER_FAILURE]);
const MAX_BACKOFF_MS = 8000;

/** Adaptador de LlmClient sobre el SDK oficial @google/genai (Gemini API). */
export class GoogleGenAiClient implements LlmClient {
  private readonly ai: GenAiLike;

  constructor(private readonly options: GoogleGenAiOptions) {
    // Claves "AIza..." y "AQ.Ab..." (autorizacion) viajan igual: encabezado x-goog-api-key contra la API de Gemini.
    // vertexai:false evita que variables como GOOGLE_GENAI_USE_VERTEXAI desvien la llamada a otro servicio.
    this.ai = options.sdk ?? new GoogleGenAI({ apiKey: options.apiKey, vertexai: false });
  }

  /** Envia con reintentos y retroceso exponencial; lanza el ultimo error si se agotan o no es reintentable. */
  private async sendWithRetries(
    model: string,
    send: (model: string) => Promise<GenerateContentResponse>,
    onAttempt: () => void,
  ): Promise<GenerateContentResponse> {
    const { maxRetries = 3, retryBaseMs = 1000, log } = this.options;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const random = this.options.random ?? Math.random;
    for (let attempt = 0; ; attempt += 1) {
      onAttempt();
      try {
        return await send(model);
      } catch (error) {
        const status = statusOf(error);
        if (status === undefined || !RETRYABLE.has(status) || attempt >= maxRetries) throw error;
        const delay = Math.min(retryBaseMs * 2 ** attempt, MAX_BACKOFF_MS) + Math.floor(random() * retryBaseMs * 0.5);
        log?.warn('Gemini no disponible momentaneamente; se reintenta', { status, model, attempt: attempt + 1, maxRetries, waitMs: delay });
        await sleep(delay);
      }
    }
  }

  async generate(request: LlmGenerateRequest): Promise<LlmMessage> {
    const contents = request.messages.map(toContent);
    const functionDeclarations = request.tools.map(toDeclaration);

    const send = (model: string): Promise<GenerateContentResponse> =>
      this.ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: request.systemInstruction,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
          // El bucle de herramientas lo controla GeminiService (validaciones y tope de productos).
          automaticFunctionCalling: { disable: true },
        },
      });

    const { model, fallbackModel } = this.options;
    const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
    let attempts = 0;
    let lastModel = model;

    try {
      let lastError: unknown;
      for (const candidate of models) {
        lastModel = candidate;
        try {
          const response = await this.sendWithRetries(candidate, send, () => {
            attempts += 1;
          });
          if (candidate !== model) this.options.log?.warn('Respuesta obtenida con el modelo alternativo', { model: candidate });
          return fromResponse(response);
        } catch (error) {
          lastError = error;
          const failure = statusOf(error);
          // Solo se pasa al modelo alternativo ante fallos de servidor; 429/401/404/400 no mejoran cambiando de modelo.
          if (failure === undefined || !SERVER_FAILURE.has(failure)) throw error;
        }
      }
      throw lastError;
    } catch (error) {
      const status = statusOf(error);
      if (status !== undefined && SERVER_FAILURE.has(status)) {
        throw new AppError('LLM_UNAVAILABLE', 'El servicio de IA esta con mucha demanda; intenta de nuevo en unos segundos', 503, {
          status,
          model: lastModel,
          attempts,
          cause: truncate(error instanceof Error ? error.message : String(error), 800),
        });
      }
      if (status === 429) {
        throw new AppError('RATE_LIMITED', 'El servicio de IA esta saturado; intenta de nuevo en un momento', 429);
      }
      if (status === 401 || status === 403) {
        throw new AppError('LLM_AUTH_ERROR', 'Google rechazo la clave de Gemini; revisa GEMINI_API_KEY', 502, {
          status,
          hint: 'Copia la clave completa de Google AI Studio (AQ.Ab... o AIza...), sin comillas ni espacios, y verifica que su proyecto tenga habilitada la API de Gemini (Generative Language API).',
          cause: truncate(error instanceof Error ? error.message : String(error), 300),
        });
      }
      if (status === 404) {
        throw new AppError('LLM_MODEL_ERROR', `El modelo de Gemini "${this.options.model}" no esta disponible para esta cuenta`, 502, {
          status,
          model: this.options.model,
          hint: 'Cambia GEMINI_MODEL en .env por un modelo vigente (por defecto gemini-3.8-flash), guarda y reinicia el servidor. Google retira modelos antiguos.',
          cause: truncate(error instanceof Error ? error.message : String(error), 800),
        });
      }
      throw new AppError('LLM_ERROR', 'Fallo la consulta al modelo de IA', 502, {
        status: status ?? null,
        cause: truncate(error instanceof Error ? error.message : String(error), 800),
      });
    }
  }
}
