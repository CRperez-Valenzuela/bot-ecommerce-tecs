import { GoogleGenAI, Type } from '@google/genai';
import type { Content, FunctionDeclaration, GenerateContentResponse, Part, Schema } from '@google/genai';
import type { LlmClient, LlmGenerateRequest, LlmMessage, LlmPart, ToolDeclaration, ToolParamSchema } from '../types/llm';
import { AppError, isAppError } from '../utils/errors';
import { RequestScheduler } from './RequestScheduler';
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
  /** Modelos alternativos, en orden, que se prueban al agotar el anterior por error de servidor, timeout o cuota (429; cada modelo tiene su propia cuota). */
  fallbackModels?: readonly string[];
  /** Tiempo maximo por intento en ms (por defecto 20000). Un intento que lo excede NO se reintenta: se pasa al siguiente modelo. */
  requestTimeoutMs?: number;
  /** Con un 429 de cuota por minuto, espera maxima en ms para reintentar en el ultimo modelo (por defecto 20000). Mas que eso => LLM_QUOTA. */
  quotaMaxWaitMs?: number;
  /** Llamadas a Gemini por minuto (0 = sin limite). Ponlo en el limite RPM de tu plan para no tocar la cuota. */
  maxRequestsPerMinute?: number;
  /** Llamadas simultaneas a Gemini (por defecto 4; 0 = sin limite). */
  maxConcurrent?: number;
  /** Espera maxima en cola antes de fallar con LLM_UNAVAILABLE (por defecto 30000). */
  queueMaxWaitMs?: number;
  /** Ventana del ritmo en ms (solo pruebas; 60000). */
  rateWindowMs?: number;
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

function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'timedOut' in error && error.timedOut === true;
}

export interface QuotaInfo {
  /** 'day' = cuota diaria (esperar no sirve); 'minute' = por minuto; 'unknown' = no se pudo saber. */
  scope: 'day' | 'minute' | 'unknown';
  /** Espera sugerida por Google (RetryInfo o "retry in Ns"); null si no la indica. */
  retryAfterMs: number | null;
}

/** Lee el cuerpo de un 429 de Gemini (JSON dentro de error.message). Tolerante: si el formato cambia devuelve 'unknown'. */
export function parseQuotaInfo(error: unknown): QuotaInfo {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  let retryAfterMs: number | null = null;
  let scope: QuotaInfo['scope'] = 'unknown';

  const retry = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(text);
  if (retry?.[1] !== undefined) retryAfterMs = Math.ceil(Number(retry[1]) * 1000);

  const quotaIds = [...text.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)].map((m) => m[1] ?? '');
  if (quotaIds.some((id) => /perday|daily/i.test(id)) || /per day|daily/i.test(text)) scope = 'day';
  else if (quotaIds.some((id) => /perminute/i.test(id)) || /per minute/i.test(text)) scope = 'minute';
  return { scope, retryAfterMs };
}

const SERVER_FAILURE = new Set([500, 502, 503, 504]);
const RETRYABLE = new Set([429, ...SERVER_FAILURE]);
const MAX_BACKOFF_MS = 8000;

/** Adaptador de LlmClient sobre el SDK oficial @google/genai (Gemini API). */
export class GoogleGenAiClient implements LlmClient {
  private readonly ai: GenAiLike;
  private readonly scheduler: RequestScheduler;

  constructor(private readonly options: GoogleGenAiOptions) {
    // Claves "AIza..." y "AQ.Ab..." (autorizacion) viajan igual: encabezado x-goog-api-key contra la API de Gemini.
    // vertexai:false evita que variables como GOOGLE_GENAI_USE_VERTEXAI desvien la llamada a otro servicio.
    this.ai = options.sdk ?? new GoogleGenAI({ apiKey: options.apiKey, vertexai: false });
    this.scheduler = new RequestScheduler({
      maxConcurrent: options.maxConcurrent ?? 4,
      maxPerWindow: options.maxRequestsPerMinute ?? 0,
      windowMs: options.rateWindowMs,
      queueMaxWaitMs: options.queueMaxWaitMs ?? 30000,
    });
  }

  /** Envia con reintentos y retroceso exponencial; lanza el ultimo error si se agotan o no es reintentable. */
  private async sendWithRetries(
    model: string,
    send: (model: string) => Promise<GenerateContentResponse>,
    onAttempt: () => void,
    hasNextModel: boolean,
  ): Promise<GenerateContentResponse> {
    const { maxRetries = 3, retryBaseMs = 1000, quotaMaxWaitMs = 20000, log } = this.options;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const random = this.options.random ?? Math.random;
    for (let attempt = 0; ; attempt += 1) {
      onAttempt();
      try {
        return await send(model);
      } catch (error) {
        const status = statusOf(error);
        // Un timeout no se reintenta en el mismo modelo: ya costo todo el tiempo maximo; se pasa al siguiente modelo.
        if (isTimeout(error) || status === undefined || !RETRYABLE.has(status) || attempt >= maxRetries) throw error;
        let delay = Math.min(retryBaseMs * 2 ** attempt, MAX_BACKOFF_MS) + Math.floor(random() * retryBaseMs * 0.5);
        if (status === 429) {
          const quota = parseQuotaInfo(error);
          log?.warn('Gemini: cuota agotada (429)', { model, scope: quota.scope, retryAfterMs: quota.retryAfterMs, haySiguienteModelo: hasNextModel });
          // Cada modelo tiene su propia cuota: si hay otro, se prueba de inmediato. Una cuota diaria no se arregla esperando.
          if (hasNextModel || quota.scope === 'day') throw error;
          if (quota.retryAfterMs !== null) {
            if (quota.retryAfterMs > quotaMaxWaitMs) throw error;
            delay = quota.retryAfterMs + Math.floor(random() * 500);
          }
        }
        log?.warn('Gemini no disponible momentaneamente; se reintenta', { status, model, attempt: attempt + 1, maxRetries, waitMs: delay });
        await sleep(delay);
      }
    }
  }

  async generate(request: LlmGenerateRequest): Promise<LlmMessage> {
    const contents = request.messages.map(toContent);
    const functionDeclarations = request.tools.map(toDeclaration);

    const timeoutMs = this.options.requestTimeoutMs ?? 20000;
    // El temporizador de cada intento empieza al salir de la cola, no al entrar.
    const sendNow = (model: string): Promise<GenerateContentResponse> => {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(`Sin respuesta de Gemini en ${timeoutMs} ms`), { status: 504, timedOut: true }));
        }, timeoutMs);
      });
      const call = this.ai.models.generateContent({
        model,
        contents,
        config: {
          abortSignal: controller.signal,
          systemInstruction: request.systemInstruction,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
          // El bucle de herramientas lo controla GeminiService (validaciones y tope de productos).
          automaticFunctionCalling: { disable: true },
        },
      });
      // Si el timeout gana, la llamada abortada puede rechazar despues: se silencia para evitar un rechazo sin manejar.
      call.catch(() => undefined);
      return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
    };
    const send = (model: string): Promise<GenerateContentResponse> => this.scheduler.run(() => sendNow(model));

    const { model, fallbackModels = [] } = this.options;
    const models = [...new Set([model, ...fallbackModels.filter((name) => name.trim() !== '')])];
    let attempts = 0;
    let lastModel = model;
    const tried: string[] = [];

    try {
      const failures: Array<{ model: string; error: unknown }> = [];
      for (const candidate of models) {
        lastModel = candidate;
        tried.push(candidate);
        try {
          const hasNext = models.indexOf(candidate) < models.length - 1;
          const response = await this.sendWithRetries(candidate, send, () => {
            attempts += 1;
          }, hasNext);
          if (candidate !== model) this.options.log?.warn('Respuesta obtenida con el modelo alternativo', { model: candidate });
          if (candidate === model && models.length > 1) this.options.log?.debug('Respuesta del modelo principal', { model });
          return fromResponse(response);
        } catch (error) {
          failures.push({ model: candidate, error });
          const failure = statusOf(error);
          if (failure === 404) {
            this.options.log?.warn('Modelo de Gemini no disponible para esta cuenta; se omite', {
              model: candidate,
              cause: truncate(error instanceof Error ? error.message : String(error), 300),
            });
          }
          // Se pasa al siguiente modelo ante fallo de servidor, timeout, cuota (429, por modelo) o modelo no disponible (404, por cuenta);
          // 401/403/400 no mejoran cambiando de modelo.
          if (failure === undefined || !(SERVER_FAILURE.has(failure) || failure === 429 || failure === 404)) throw error;
        }
      }
      // Un 404 solo dice que ese modelo no esta disponible; si otro modelo fallo por cuota/saturacion/timeout, ese es el problema real.
      const chosen = [...failures].reverse().find((failure) => statusOf(failure.error) !== 404) ?? failures[failures.length - 1];
      lastModel = chosen?.model ?? lastModel;
      throw chosen?.error;
    } catch (error) {
      // Errores ya clasificados (p. ej. la espera en cola agotada) se propagan tal cual.
      if (isAppError(error)) throw error;
      const status = statusOf(error);
      if (status !== undefined && SERVER_FAILURE.has(status)) {
        throw new AppError('LLM_UNAVAILABLE', 'El servicio de IA esta con mucha demanda; intenta de nuevo en unos segundos', 503, {
          status,
          timedOut: isTimeout(error),
          modelsTried: tried,
          model: lastModel,
          attempts,
          cause: truncate(error instanceof Error ? error.message : String(error), 800),
        });
      }
      if (status === 429) {
        const quota = parseQuotaInfo(error);
        this.options.log?.warn('Cuota de Gemini agotada en todos los modelos probados', { modelsTried: tried, scope: quota.scope });
        throw new AppError('LLM_QUOTA', 'Se alcanzo el limite de uso de Gemini; espera un momento e intenta de nuevo', 429, {
          status,
          scope: quota.scope,
          retryAfterSeconds: quota.retryAfterMs === null ? null : Math.ceil(quota.retryAfterMs / 1000),
          modelsTried: tried,
          cause: truncate(error instanceof Error ? error.message : String(error), 800),
        });
      }
      if (status === 401 || status === 403) {
        throw new AppError('LLM_AUTH_ERROR', 'Google rechazo la clave de Gemini; revisa GEMINI_API_KEY', 502, {
          status,
          hint: 'Copia la clave completa de Google AI Studio (AQ.Ab... o AIza...), sin comillas ni espacios, y verifica que su proyecto tenga habilitada la API de Gemini (Generative Language API).',
          cause: truncate(error instanceof Error ? error.message : String(error), 300),
        });
      }
      if (status === 404) {
        const names = tried.map((name) => `"${name}"`).join(', ');
        throw new AppError('LLM_MODEL_ERROR', `Gemini no tiene disponible para esta cuenta ${tried.length > 1 ? 'ninguno de los modelos' : 'el modelo'} ${names}`, 502, {
          status,
          model: lastModel,
          modelsTried: tried,
          hint: 'Cambia GEMINI_MODEL / GEMINI_FALLBACK_MODEL en .env por modelos que respondan con tu clave (prueba: node probe-models.js modelo1 modelo2), guarda y reinicia el servidor.',
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
