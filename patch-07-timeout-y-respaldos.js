#!/usr/bin/env node
'use strict';
/**
 * patch-07-timeout-y-respaldos.js - Bot Ecommerce TECS Acarigua
 * Sesion 7 (correccion): tiempo maximo por intento y cadena de modelos de respaldo, 2026-11-21.
 * Requiere haber aplicado antes los parches de la sesion 3.
 *
 * Uso (en la RAIZ del proyecto local, Windows o Linux):
 *   node patch-07-timeout-y-respaldos.js            escribe/actualiza los archivos
 *   node patch-07-timeout-y-respaldos.js --dry-run  muestra que haria, sin escribir nada
 *
 * Solo usa los modulos nativos fs y path. Crea las carpetas que falten y sobrescribe
 * los archivos listados (usa git para revisar el diff). No toca .env ni otros archivos.
 * Contiene SOLO los archivos creados o modificados en esta sesion.
 */
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = process.cwd();

// [ruta relativa con "/", contenido]
const FILES = [
  [".env.example", `# ============================================================
# Bot Ecommerce TECS Acarigua - Variables de entorno
# Copia este archivo a .env y ajusta los valores.
# ============================================================

# --- Servidor ---
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
# Si se define, POST /api/chat (simulador/demo) exige el encabezado x-api-key con este valor
CHAT_API_KEY=
# Simulador web de demostracion en http://localhost:PORT/demo (true | false)
DEMO_ENABLED=true

# --- Limite de tasa por IP en POST /api/chat (protege el consumo de Gemini) ---
RATE_LIMIT_ENABLED=true
# Mensajes permitidos por IP en cada ventana
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_SECONDS=60
# Saltos de proxy inverso de confianza (0 = ninguno). Detras de nginx/Caddy/Cloudflare usa 1; si no, todos
# los clientes parecen tener la IP del proxy y comparten el mismo limite. NO lo subas sin proxy: se podria falsear la IP.
TRUST_PROXY=0

# --- Logs en archivo (ademas de la salida estandar) ---
# Si se define, escribe app-AAAA-MM-DD.log en esa carpeta. Con Docker lo fija docker-compose.yml (./storage/logs).
LOG_DIR=
# Dias de archivos que se conservan
LOG_RETENTION_DAYS=14

# --- Interruptor de arquitectura dual: mock | live ---
# mock: catalogo local (data/catalog.mock.json), leads en data/leads.mock.json
# live: Odoo Community via XML-RPC (requiere las variables ODOO_* de abajo)
ODOO_MODE=mock

# --- Modo MOCK ---
MOCK_CATALOG_PATH=./data/catalog.mock.json
MOCK_LEADS_PATH=./data/leads.mock.json

# --- Modo LIVE (Odoo Community, XML-RPC) ---
ODOO_URL=http://localhost:8069
ODOO_DB=tecs
ODOO_USERNAME=bot@tecs.local
# Contrasena o API key del usuario de integracion
ODOO_PASSWORD=
ODOO_TIMEOUT_MS=15000
# Campo de product.template donde viven las especificaciones tecnicas
# (lineas "clave: valor"). Por defecto description_sale.
ODOO_SPECS_FIELD=description_sale
# Mapa opcional categoria-bot -> nombre de categoria en Odoo (JSON). Se mezcla con los valores por defecto.
# Claves: cpu, motherboard, ram, storage, gpu, psu, case, laptop, service
# ODOO_CATEGORY_MAP={"cpu":"Procesadores","case":"Cases"}
# Si es true, ademas del crm.lead se crea una cotizacion borrador (sale.order)
ODOO_CREATE_QUOTATION=false

# --- Gemini ---
# Clave de Google AI Studio: vale el formato nuevo (AQ.Ab...) y el antiguo (AIza...). Sin comillas ni espacios.
# Se lee de este archivo (en la raiz del proyecto, junto a package.json) o del entorno; el entorno tiene prioridad.
# Guarda este archivo como UTF-8; el cargador tambien tolera BOM y UTF-16, pero avisa en el arranque.
# Tras editarlo, reinicia el servidor (npm run dev NO se reinicia solo al cambiar .env).
GEMINI_API_KEY=
# Modelo de Gemini. Google retira modelos con el tiempo: si ves LLM_MODEL_ERROR (404), cambia este valor por uno vigente.
# (gemini-2.5-flash ya no esta disponible para cuentas nuevas.) Este valor en .env manda sobre el valor por defecto del codigo.
GEMINI_MODEL=gemini-3.8-flash
# Alta demanda de Gemini (503 UNAVAILABLE, 429): se reintenta con espera creciente (1 s, 2 s, 4 s... mas un poco de azar).
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_BASE_MS=1000
# Opcional: modelos alternativos, separados por coma y en orden, que se prueban si el principal sigue con error de servidor,
# saturacion o timeout. Vacio = ninguno. Prueba cuales responden con tu clave: node probe-models.js modelo1 modelo2
GEMINI_FALLBACK_MODEL=
# Tiempo maximo por intento a Gemini (ms). Un intento que lo excede no se reintenta: pasa al siguiente modelo.
GEMINI_REQUEST_TIMEOUT_MS=20000
GEMINI_TEMPERATURE=0.4
GEMINI_MAX_TOOL_ROUNDS=6

# --- Sesiones en memoria ---
SESSION_TTL_MINUTES=120
SESSION_MAX_COUNT=5000
SESSION_MAX_HISTORY_TURNS=14

# --- Datos de la tienda ---
STORE_NAME=TECS
STORE_CITY=Acarigua, Portuguesa
# Direccion y horario: SOLO se comparten en WhatsApp/Instagram (nunca en Mercado Libre)
STORE_ADDRESS=
STORE_HOURS=
BUILD_DELIVERY_ETA=24 a 48 horas habiles tras confirmar el pago

# --- Canal: WhatsApp Cloud API ---
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=

# --- Canal: Instagram DM ---
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_VERIFY_TOKEN=

# --- Meta (WhatsApp + Instagram) ---
# Version del Graph API (verifica la vigente en developers.facebook.com)
META_GRAPH_VERSION=v23.0
# Secreto de la app: valida la firma X-Hub-Signature-256. Obligatorio en produccion.
META_APP_SECRET=

# --- Canal: Mercado Libre ---
MERCADOLIBRE_ACCESS_TOKEN=
MERCADOLIBRE_REFRESH_TOKEN=
MERCADOLIBRE_CLIENT_ID=
MERCADOLIBRE_CLIENT_SECRET=
# ID de usuario vendedor: se usa para validar las notificaciones y ignorar preguntas propias
MERCADOLIBRE_SELLER_ID=

# ============================================================
# --- Solo Docker (los lee docker-compose.yml; install.sh los completa) ---
# ============================================================
# Puerto del equipo donde se publica el bot (dentro del contenedor siempre es 3000)
HOST_PORT=3000
# 127.0.0.1 = solo este equipo | 0.0.0.0 = toda la red. Para internet usa un proxy inverso con HTTPS.
BIND_ADDRESS=127.0.0.1
# Usuario/grupo con el que corre el contenedor (deben poder escribir en ./storage). install.sh usa los tuyos.
APP_UID=1000
APP_GID=1000
# Zona horaria de los archivos de log diarios
TZ=America/Caracas
# Con Docker, "localhost" es el propio contenedor. Si Odoo corre en este mismo servidor usa:
#   ODOO_URL=http://host.docker.internal:8069
`],
  ["src/ai/GoogleGenAiClient.ts", `import { GoogleGenAI, Type } from '@google/genai';
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
  /** Modelos alternativos, en orden, que se prueban al agotar el anterior por un error de servidor o timeout (no con 429). */
  fallbackModels?: readonly string[];
  /** Tiempo maximo por intento en ms (por defecto 20000). Un intento que lo excede NO se reintenta: se pasa al siguiente modelo. */
  requestTimeoutMs?: number;
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
        // Un timeout no se reintenta en el mismo modelo: ya costo todo el tiempo maximo; se pasa al siguiente modelo.
        if (isTimeout(error) || status === undefined || !RETRYABLE.has(status) || attempt >= maxRetries) throw error;
        const delay = Math.min(retryBaseMs * 2 ** attempt, MAX_BACKOFF_MS) + Math.floor(random() * retryBaseMs * 0.5);
        log?.warn('Gemini no disponible momentaneamente; se reintenta', { status, model, attempt: attempt + 1, maxRetries, waitMs: delay });
        await sleep(delay);
      }
    }
  }

  async generate(request: LlmGenerateRequest): Promise<LlmMessage> {
    const contents = request.messages.map(toContent);
    const functionDeclarations = request.tools.map(toDeclaration);

    const timeoutMs = this.options.requestTimeoutMs ?? 20000;
    const send = (model: string): Promise<GenerateContentResponse> => {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(\`Sin respuesta de Gemini en \${timeoutMs} ms\`), { status: 504, timedOut: true }));
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

    const { model, fallbackModels = [] } = this.options;
    const models = [...new Set([model, ...fallbackModels.filter((name) => name.trim() !== '')])];
    let attempts = 0;
    let lastModel = model;
    const tried: string[] = [];

    try {
      let lastError: unknown;
      for (const candidate of models) {
        lastModel = candidate;
        tried.push(candidate);
        try {
          const response = await this.sendWithRetries(candidate, send, () => {
            attempts += 1;
          });
          if (candidate !== model) this.options.log?.warn('Respuesta obtenida con el modelo alternativo', { model: candidate });
          if (candidate === model && models.length > 1) this.options.log?.debug('Respuesta del modelo principal', { model });
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
          timedOut: isTimeout(error),
          modelsTried: tried,
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
        throw new AppError('LLM_MODEL_ERROR', \`El modelo de Gemini "\${this.options.model}" no esta disponible para esta cuenta\`, 502, {
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
`],
  ["src/config/env.ts", `import type { OdooMode, ProductCategory } from '../types/domain';
import { PRODUCT_CATEGORIES } from '../types/domain';
import type { LogLevel } from '../utils/logger';
import { AppError } from '../utils/errors';

export type OdooCategoryKey = ProductCategory | 'service';

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
  timeoutMs: number;
  /** Categoria del bot -> nombre de categoria en Odoo (se busca con child_of). */
  categoryMap: Record<OdooCategoryKey, string>;
  /** Campo de product.template con las especificaciones ("clave: valor" por linea). */
  specsField: string;
  createQuotation: boolean;
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: LogLevel;
  /** Si se define, POST /api/chat exige el encabezado x-api-key con este valor. */
  chatApiKey: string | null;
  /** Sirve el simulador web en /demo (carpeta public/demo). */
  demoEnabled: boolean;
  /** Limite de solicitudes por IP en POST /api/chat (protege el consumo de Gemini). */
  rateLimit: { enabled: boolean; max: number; windowSeconds: number };
  /** Saltos de proxy inverso de confianza (0 = ninguno). Solo asi se usa X-Forwarded-For para la IP real. */
  trustProxy: number;
  /** Si logging.dir no es null, ademas de la salida estandar se escribe app-AAAA-MM-DD.log en esa carpeta. */
  logging: { dir: string | null; retentionDays: number };
  odooMode: OdooMode;
  mock: { catalogPath: string; leadsPath: string };
  /** Solo presente cuando ODOO_MODE=live. */
  odoo: OdooConfig | null;
  gemini: {
    apiKey: string | null;
    /** Variable de la que se leyo la clave (GEMINI_API_KEY, o GOOGLE_API_KEY como alternativa). */
    keySource: GeminiKeyResolution['source'];
    /** Aviso si la clave parece mal copiada; null si todo bien. */
    keyWarning: string | null;
    model: string;
    /** Reintentos ante alta demanda (429/5xx) y espera base en ms (retroceso exponencial). */
    maxRetries: number;
    retryBaseMs: number;
    /** Modelos alternativos en orden ante fallos de servidor o timeout (GEMINI_FALLBACK_MODEL, separados por coma). */
    fallbackModels: string[];
    /** Tiempo maximo por intento a Gemini en ms. */
    requestTimeoutMs: number;
    temperature: number;
    maxToolRounds: number;
  };
  session: { ttlMinutes: number; maxSessions: number; maxHistoryTurns: number };
  store: { name: string; city: string; address: string; hours: string; deliveryEta: string };
  channels: {
    graphVersion: string;
    metaAppSecret: string | null;
    whatsapp: { phoneNumberId: string; accessToken: string; verifyToken: string };
    instagram: { accessToken: string; verifyToken: string };
    mercadolibre: {
      accessToken: string;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      sellerId: string;
    };
  };
}

export const DEFAULT_CATEGORY_MAP: Record<OdooCategoryKey, string> = {
  cpu: 'Procesadores',
  motherboard: 'Placas Madre',
  ram: 'Memoria RAM',
  storage: 'Almacenamiento',
  gpu: 'Tarjetas de Video',
  psu: 'Fuentes de Poder',
  case: 'Cases',
  laptop: 'Laptops',
  service: 'Servicios',
};

/** Modelo por defecto. Google retira modelos con el tiempo (p. ej. gemini-2.5-flash ya no esta disponible para cuentas nuevas). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export { loadDotEnv } from './dotenv';
export type { DotEnvReport } from './dotenv';

export interface GeminiKeyResolution {
  /** Clave lista para el SDK (null si no hay). Sin comillas, espacios ni caracteres invisibles. */
  key: string | null;
  /** Variable de la que salio la clave. */
  source: 'GEMINI_API_KEY' | 'GOOGLE_API_KEY' | null;
  /** Aviso legible si la clave parece mal copiada (nunca incluye la clave). */
  warning: string | null;
}

/**
 * Normaliza la clave de Gemini. NO valida prefijo ni longitud a proposito: Google emite claves "AIza..." (estandar,
 * en retiro) y "AQ.Ab..." (de autorizacion) y el formato puede volver a cambiar. Solo limpia lo que rompe la copia:
 * comillas, espacios y caracteres invisibles (BOM, espacio de ancho cero).
 */
export function resolveGeminiKey(env: NodeJS.ProcessEnv): GeminiKeyResolution {
  const clean = (raw: string | undefined): string => {
    let value = (raw ?? '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim();
    if (value.length >= 2 && /^["'\`]/.test(value) && value.endsWith(value[0] ?? '')) value = value.slice(1, -1).trim();
    return value;
  };
  const candidates = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;
  for (const name of candidates) {
    const key = clean(env[name]);
    if (key === '') continue;
    let warning: string | null = null;
    if (/\\s/.test(key)) warning = \`\${name} contiene espacios o saltos de linea: probablemente se copio mal\`;
    else if (/^(tu_|your_|xxx|changeme|<)/i.test(key)) warning = \`\${name} parece un valor de ejemplo y no una clave real\`;
    return { key, source: name, warning };
  }
  return { key: null, source: null, warning: null };
}

class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  str(key: string, fallback = ''): string {
    const value = this.env[key];
    return value === undefined ? fallback : value.trim();
  }

  int(key: string, fallback: number, min: number, max: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.errors.push(\`\${key} debe ser un entero entre \${min} y \${max}\`);
      return fallback;
    }
    return value;
  }

  float(key: string, fallback: number, min: number, max: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      this.errors.push(\`\${key} debe ser un numero entre \${min} y \${max}\`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return fallback;
    if (['true', '1', 'yes', 'si'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    this.errors.push(\`\${key} debe ser true o false\`);
    return fallback;
  }

  required(key: string): string {
    const value = this.str(key);
    if (value === '') this.errors.push(\`\${key} es obligatorio cuando ODOO_MODE=live\`);
    return value;
  }
}

function parseCategoryMap(raw: string, errors: string[]): Record<OdooCategoryKey, string> {
  const map: Record<OdooCategoryKey, string> = { ...DEFAULT_CATEGORY_MAP };
  if (raw === '') return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push('ODOO_CATEGORY_MAP no es JSON valido');
    return map;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push('ODOO_CATEGORY_MAP debe ser un objeto JSON');
    return map;
  }
  const allowed: readonly string[] = [...PRODUCT_CATEGORIES, 'service'];
  for (const [key, value] of Object.entries(parsed)) {
    if (!allowed.includes(key)) {
      errors.push(\`ODOO_CATEGORY_MAP: clave desconocida "\${key}"\`);
    } else if (typeof value !== 'string' || value.trim() === '') {
      errors.push(\`ODOO_CATEGORY_MAP: valor invalido para "\${key}"\`);
    } else {
      map[key as OdooCategoryKey] = value.trim();
    }
  }
  return map;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = new EnvReader(env);
  const geminiKey = resolveGeminiKey(env);

  const modeRaw = r.str('ODOO_MODE', 'mock').toLowerCase();
  if (modeRaw !== 'mock' && modeRaw !== 'live') r.errors.push('ODOO_MODE debe ser "mock" o "live"');
  const odooMode: OdooMode = modeRaw === 'live' ? 'live' : 'mock';

  const nodeEnvRaw = r.str('NODE_ENV', 'development');
  const nodeEnv = nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const logRaw = r.str('LOG_LEVEL', 'info');
  const logLevel: LogLevel = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === logRaw) ?? 'info';

  let odoo: OdooConfig | null = null;
  if (odooMode === 'live') {
    odoo = {
      url: r.required('ODOO_URL').replace(/\\/+$/, ''),
      db: r.required('ODOO_DB'),
      username: r.required('ODOO_USERNAME'),
      password: r.required('ODOO_PASSWORD'),
      timeoutMs: r.int('ODOO_TIMEOUT_MS', 15000, 1000, 120000),
      categoryMap: parseCategoryMap(r.str('ODOO_CATEGORY_MAP'), r.errors),
      specsField: r.str('ODOO_SPECS_FIELD', 'description_sale'),
      createQuotation: r.bool('ODOO_CREATE_QUOTATION', false),
    };
  }

  const config: AppConfig = {
    nodeEnv,
    port: r.int('PORT', 3000, 1, 65535),
    logLevel,
    chatApiKey: r.str('CHAT_API_KEY') || null,
    demoEnabled: r.bool('DEMO_ENABLED', true),
    rateLimit: {
      enabled: r.bool('RATE_LIMIT_ENABLED', true),
      max: r.int('RATE_LIMIT_MAX', 20, 1, 100000),
      windowSeconds: r.int('RATE_LIMIT_WINDOW_SECONDS', 60, 1, 86400),
    },
    trustProxy: r.int('TRUST_PROXY', 0, 0, 10),
    logging: {
      dir: r.str('LOG_DIR') || null,
      retentionDays: r.int('LOG_RETENTION_DAYS', 14, 1, 3650),
    },
    odooMode,
    mock: {
      catalogPath: r.str('MOCK_CATALOG_PATH', './data/catalog.mock.json'),
      leadsPath: r.str('MOCK_LEADS_PATH', './data/leads.mock.json'),
    },
    odoo,
    gemini: {
      apiKey: geminiKey.key,
      keySource: geminiKey.source,
      keyWarning: geminiKey.warning,
      model: r.str('GEMINI_MODEL', DEFAULT_GEMINI_MODEL),
      maxRetries: r.int('GEMINI_MAX_RETRIES', 3, 0, 6),
      retryBaseMs: r.int('GEMINI_RETRY_BASE_MS', 1000, 0, 30000),
      fallbackModels: r.str('GEMINI_FALLBACK_MODEL').split(',').map((name) => name.trim()).filter((name) => name !== ''),
      requestTimeoutMs: r.int('GEMINI_REQUEST_TIMEOUT_MS', 20000, 1000, 120000),
      temperature: r.float('GEMINI_TEMPERATURE', 0.4, 0, 2),
      maxToolRounds: r.int('GEMINI_MAX_TOOL_ROUNDS', 6, 1, 12),
    },
    session: {
      ttlMinutes: r.int('SESSION_TTL_MINUTES', 120, 1, 10080),
      maxSessions: r.int('SESSION_MAX_COUNT', 5000, 10, 1000000),
      maxHistoryTurns: r.int('SESSION_MAX_HISTORY_TURNS', 14, 2, 100),
    },
    store: {
      name: r.str('STORE_NAME', 'TECS'),
      city: r.str('STORE_CITY', 'Acarigua, Portuguesa'),
      address: r.str('STORE_ADDRESS'),
      hours: r.str('STORE_HOURS'),
      deliveryEta: r.str('BUILD_DELIVERY_ETA', '24 a 48 horas hábiles tras confirmar el pago'),
    },
    channels: {
      graphVersion: r.str('META_GRAPH_VERSION', 'v23.0'),
      metaAppSecret: r.str('META_APP_SECRET') || null,
      whatsapp: {
        phoneNumberId: r.str('WHATSAPP_PHONE_NUMBER_ID'),
        accessToken: r.str('WHATSAPP_ACCESS_TOKEN'),
        verifyToken: r.str('WHATSAPP_VERIFY_TOKEN'),
      },
      instagram: {
        accessToken: r.str('INSTAGRAM_ACCESS_TOKEN'),
        verifyToken: r.str('INSTAGRAM_VERIFY_TOKEN'),
      },
      mercadolibre: {
        accessToken: r.str('MERCADOLIBRE_ACCESS_TOKEN'),
        refreshToken: r.str('MERCADOLIBRE_REFRESH_TOKEN'),
        clientId: r.str('MERCADOLIBRE_CLIENT_ID'),
        clientSecret: r.str('MERCADOLIBRE_CLIENT_SECRET'),
        sellerId: r.str('MERCADOLIBRE_SELLER_ID'),
      },
    },
  };

  if (r.errors.length > 0) {
    throw new AppError('CONFIG_ERROR', 'Configuracion de entorno invalida', 500, r.errors);
  }
  return config;
}
`],
  ["src/container.ts", `import { ChannelDispatcher } from './channels/ChannelDispatcher';
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
        ? new GoogleGenAiClient({
            apiKey: config.gemini.apiKey,
            model: config.gemini.model,
            maxRetries: config.gemini.maxRetries,
            retryBaseMs: config.gemini.retryBaseMs,
            fallbackModels: config.gemini.fallbackModels,
            requestTimeoutMs: config.gemini.requestTimeoutMs,
            log: log.child({ component: 'gemini-client' }),
          })
        : null;
  if (llm === null) {
    log.warn('GEMINI_API_KEY no configurada: el asistente respondera LLM_NOT_CONFIGURED', {
      hint: 'Defínela en el archivo .env (junto a package.json) o en el entorno, y reinicia el servidor',
    });
  } else if (overrides.llm === undefined && config.gemini.apiKey !== null) {
    // Solo longitud y 3 primeros caracteres (AQ. / AIz): sirve para diagnosticar sin exponer la clave.
    log.info('Gemini configurado', {
      source: config.gemini.keySource,
      keyLength: config.gemini.apiKey.length,
      keyPrefix: config.gemini.apiKey.slice(0, 3),
      model: config.gemini.model,
    });
    if (config.gemini.keyWarning !== null) log.warn(config.gemini.keyWarning);
  }

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
`],
  ["tests/dotenv-and-gemini-key.test.ts", `import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { GoogleGenAiClient } from '../src/ai/GoogleGenAiClient';
import type { GenAiLike } from '../src/ai/GoogleGenAiClient';
import { decodeEnvFile, envFileCandidates, loadDotEnv, parseDotEnv } from '../src/config/dotenv';
import { loadConfig, resolveGeminiKey } from '../src/config/env';
import { isAppError } from '../src/utils/errors';

const AQ_KEY = 'AQ.Ab8RN6Jyw-hTw4HqaKz_example.KEY';
const AIZA_KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrstuv';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-dotenv-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const utf16le = (text: string, bom: boolean): Buffer =>
  Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')]);

describe('parseDotEnv', () => {
  it('lee comillas, export, comentarios y deja "$" literal', () => {
    const { values, warnings } = parseDotEnv(
      [
        '# comentario',
        '',
        \`GEMINI_API_KEY=\${AQ_KEY}\`,
        "STORE_NAME='Tienda $HOME #1'",
        'STORE_CITY="Acarigua\\\\nPortuguesa"',
        'export PORT=3000 # puerto',
        'EMPTY=',
        'SPACED =  valor con espacios  ',
      ].join('\\n'),
    );
    assert.deepEqual(warnings, []);
    assert.equal(values.GEMINI_API_KEY, AQ_KEY);
    assert.equal(values.STORE_NAME, 'Tienda $HOME #1');
    assert.equal(values.STORE_CITY, 'Acarigua\\nPortuguesa');
    assert.equal(values.PORT, '3000');
    assert.equal(values.EMPTY, '');
    assert.equal(values.SPACED, 'valor con espacios');
  });

  it('acepta saltos CRLF (Windows) sin dejar "\\\\r" en los valores', () => {
    const { values } = parseDotEnv(\`A=1\\r\\nGEMINI_API_KEY=\${AQ_KEY}\\r\\nB="2"\\r\\n\`);
    assert.equal(values.A, '1');
    assert.equal(values.GEMINI_API_KEY, AQ_KEY);
    assert.equal(values.B, '2');
  });

  it('ignora el BOM al inicio: la primera variable conserva su nombre', () => {
    const { values } = parseDotEnv(\`﻿GEMINI_API_KEY=\${AQ_KEY}\\nPORT=3000\\n\`);
    assert.deepEqual(Object.keys(values), ['GEMINI_API_KEY', 'PORT']);
  });

  it('avisa de lineas mal formadas y de comillas sin cerrar, sin incluir valores', () => {
    const { values, warnings } = parseDotEnv(\`texto suelto\\n1MALO=x\\nSECRETO="abc\`);
    assert.equal(values.SECRETO, 'abc');
    assert.equal(warnings.length, 3);
    assert.ok(warnings.every((w) => !w.includes('abc')));
  });
});

describe('decodeEnvFile', () => {
  const text = \`GEMINI_API_KEY=\${AQ_KEY}\\nPORT=3000\\n\`;

  it('UTF-8 sin BOM, con BOM, UTF-16 LE/BE con BOM y UTF-16 LE sin BOM', () => {
    const cases: Array<[Buffer, string]> = [
      [Buffer.from(text, 'utf8'), 'utf8'],
      [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]), 'utf8-bom'],
      [utf16le(text, true), 'utf16le'],
      [utf16le(text, false), 'utf16le'],
      [(() => {
        const body = Buffer.from(text, 'utf16le');
        body.swap16();
        return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
      })(), 'utf16be'],
    ];
    for (const [buffer, encoding] of cases) {
      const decoded = decodeEnvFile(buffer);
      assert.equal(decoded.encoding, encoding);
      assert.equal(parseDotEnv(decoded.text).values.GEMINI_API_KEY, AQ_KEY, encoding);
    }
  });
});

describe('loadDotEnv', () => {
  it('carga un .env UTF-16 (el que genera PowerShell con ">") y reporta el aviso', () => {
    fs.writeFileSync(path.join(dir, '.env'), utf16le(\`GEMINI_API_KEY=\${AQ_KEY}\\r\\n\`, true));
    const env: NodeJS.ProcessEnv = {};
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(report.encoding, 'utf16le');
    assert.deepEqual(report.appliedKeys, ['GEMINI_API_KEY']);
    assert.ok(report.warnings.some((w) => w.includes('UTF-8')));
  });

  it('carga un .env con BOM UTF-8 y la clave queda con el nombre correcto', () => {
    fs.writeFileSync(path.join(dir, '.env'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(\`GEMINI_API_KEY=\${AQ_KEY}\\r\\n\`)]));
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(Object.keys(env).some((k) => k.includes('﻿')), false);
  });

  it('el entorno real con valor gana; uno vacio o solo espacios se rellena desde el archivo', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'GEMINI_API_KEY=del_archivo\\nA=del_archivo\\nB=del_archivo\\nC=del_archivo\\n');
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: AQ_KEY, A: '', B: '   ' };
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(env.GEMINI_API_KEY, AQ_KEY);
    assert.equal(env.A, 'del_archivo');
    assert.equal(env.B, 'del_archivo');
    assert.equal(env.C, 'del_archivo');
    assert.deepEqual(report.keptFromEnvironment, ['GEMINI_API_KEY']);
  });

  it('busca primero en la carpeta de trabajo y despues en la raiz del proyecto', () => {
    const root = path.join(dir, 'root');
    const cwd = path.join(dir, 'cwd');
    fs.mkdirSync(root);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(root, '.env'), 'ORIGEN=raiz\\n');

    const env1: NodeJS.ProcessEnv = {};
    const report1 = loadDotEnv({ cwd, projectRoot: root, env: env1 });
    assert.equal(env1.ORIGEN, 'raiz');
    assert.equal(report1.path, path.join(root, '.env'));

    fs.writeFileSync(path.join(cwd, '.env'), 'ORIGEN=cwd\\n');
    const env2: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd, projectRoot: root, env: env2 });
    assert.equal(env2.ORIGEN, 'cwd');
    assert.equal(envFileCandidates({ cwd: root, projectRoot: root }).length, 1);
  });

  it('sin .env no falla: informa donde busco', () => {
    const env: NodeJS.ProcessEnv = {};
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env });
    assert.equal(report.path, null);
    assert.deepEqual(report.searched, [path.join(dir, '.env')]);
    assert.deepEqual(env, {});
  });

  it('un .env ilegible (es una carpeta) no lanza excepcion', () => {
    fs.mkdirSync(path.join(dir, '.env'));
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env: {} });
    assert.equal(report.path, null);
  });

  it('el informe nunca contiene valores', () => {
    fs.writeFileSync(path.join(dir, '.env'), \`GEMINI_API_KEY=\${AQ_KEY}\\nmalo\\n\`);
    const report = loadDotEnv({ cwd: dir, projectRoot: dir, env: {} });
    assert.equal(JSON.stringify(report).includes(AQ_KEY), false);
  });
});

describe('resolveGeminiKey / loadConfig', () => {
  it('acepta claves AQ.Ab... y AIza... sin validar prefijo ni longitud', () => {
    for (const key of [AQ_KEY, AIZA_KEY, 'AQ.x', 'cualquier-formato-futuro-0123456789']) {
      const resolved = resolveGeminiKey({ GEMINI_API_KEY: key });
      assert.equal(resolved.key, key);
      assert.equal(resolved.warning, null);
      assert.equal(loadConfig({ GEMINI_API_KEY: key }).gemini.apiKey, key);
    }
  });

  it('quita comillas, espacios y caracteres invisibles', () => {
    for (const raw of [\`"\${AQ_KEY}"\`, \`'\${AQ_KEY}'\`, \`  \${AQ_KEY}  \`, \`﻿\${AQ_KEY}\`, \`\${AQ_KEY}​\`, \`\${AQ_KEY}\\r\`]) {
      assert.equal(resolveGeminiKey({ GEMINI_API_KEY: raw }).key, AQ_KEY, JSON.stringify(raw));
    }
  });

  it('GEMINI_API_KEY manda; GOOGLE_API_KEY es alternativa si la primera esta vacia', () => {
    assert.equal(resolveGeminiKey({ GEMINI_API_KEY: AQ_KEY, GOOGLE_API_KEY: AIZA_KEY }).source, 'GEMINI_API_KEY');
    const fallback = resolveGeminiKey({ GEMINI_API_KEY: '', GOOGLE_API_KEY: AIZA_KEY });
    assert.equal(fallback.key, AIZA_KEY);
    assert.equal(fallback.source, 'GOOGLE_API_KEY');
  });

  it('sin clave devuelve null; con espacios internos o ejemplo avisa sin incluir la clave', () => {
    assert.deepEqual(resolveGeminiKey({}), { key: null, source: null, warning: null });
    assert.equal(resolveGeminiKey({ GEMINI_API_KEY: '   ' }).key, null);

    const spaced = resolveGeminiKey({ GEMINI_API_KEY: 'AQ.Ab 123' });
    assert.ok(spaced.warning?.includes('espacios'));
    assert.equal(spaced.warning?.includes('AQ.Ab'), false);

    assert.ok(resolveGeminiKey({ GEMINI_API_KEY: 'tu_clave_aqui' }).warning?.includes('ejemplo'));
  });

  it('flujo completo: .env con BOM + CRLF => loadConfig ve la clave', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(\`GEMINI_API_KEY="\${AQ_KEY}"\\r\\nPORT=3100\\r\\n\`)]),
    );
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ cwd: dir, projectRoot: dir, env });
    const config = loadConfig(env);
    assert.equal(config.gemini.apiKey, AQ_KEY);
    assert.equal(config.gemini.keySource, 'GEMINI_API_KEY');
    assert.equal(config.port, 3100);
  });
});

describe('GoogleGenAiClient: errores de autenticacion', () => {
  const request = {
    systemInstruction: 'sistema',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 256,
  };
  const failing = (status: number): GenAiLike => ({
    models: {
      generateContent: async () => {
        throw Object.assign(new Error(\`HTTP \${status}\`), { status });
      },
    },
  });

  it('401 y 403 => LLM_AUTH_ERROR con pista y sin reintentos', async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const sdk: GenAiLike = {
        models: {
          generateContent: async (params) => {
            calls += 1;
            return failing(status).models.generateContent(params);
          },
        },
      };
      const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'm', sdk });
      await assert.rejects(client.generate(request), (error: unknown) => {
        assert.ok(isAppError(error));
        assert.equal(error.code, 'LLM_AUTH_ERROR');
        assert.equal(error.httpStatus, 502);
        assert.equal(JSON.stringify(error.details).includes(AQ_KEY), false);
        return true;
      });
      assert.equal(calls, 1);
    }
  });

  it('otros fallos siguen siendo LLM_ERROR y 429 RATE_LIMITED', async () => {
    const run = async (status: number): Promise<string> => {
      const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'm', sdk: failing(status), sleep: async () => {} });
      try {
        await client.generate(request);
      } catch (error) {
        return isAppError(error) ? error.code : 'otro';
      }
      return 'sin error';
    };
    assert.equal(await run(400), 'LLM_ERROR');
    assert.equal(await run(429), 'RATE_LIMITED');
  });
});

describe('GoogleGenAiClient: modelo retirado (404)', () => {
  it('404 => LLM_MODEL_ERROR con el modelo y la pista, y el modelo por defecto es vigente', async () => {
    const sdk: GenAiLike = {
      models: {
        generateContent: async () => {
          throw Object.assign(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'), { status: 404 });
        },
      },
    };
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'gemini-2.5-flash', sdk });
    await assert.rejects(
      client.generate({ systemInstruction: 's', messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hola' }] }], tools: [], temperature: 0.4, maxOutputTokens: 64 }),
      (error: unknown) => {
        assert.ok(isAppError(error));
        assert.equal(error.code, 'LLM_MODEL_ERROR');
        assert.match(error.message, /gemini-2\\.5-flash/);
        assert.equal((error.details as { model: string }).model, 'gemini-2.5-flash');
        return true;
      },
    );
    assert.equal(loadConfig({}).gemini.model, 'gemini-3.8-flash');
    assert.equal(loadConfig({ GEMINI_MODEL: 'otro-modelo' }).gemini.model, 'otro-modelo');
  });
});

describe('GoogleGenAiClient: alta demanda (503) con reintentos', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'hola, soy el bot' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;
  const unavailable = (): Error => Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 });

  /** SDK que falla segun un guion por modelo y registra las llamadas. */
  function scripted(script: Record<string, Array<'503' | 'ok' | '429'>>): { sdk: GenAiLike; calls: string[] } {
    const calls: string[] = [];
    const counters: Record<string, number> = {};
    const sdk: GenAiLike = {
      models: {
        generateContent: async (params) => {
          const model = (params as { model: string }).model;
          calls.push(model);
          const index = counters[model] ?? 0;
          counters[model] = index + 1;
          const step = script[model]?.[index] ?? script[model]?.at(-1) ?? 'ok';
          if (step === 'ok') return okResponse;
          if (step === '429') throw Object.assign(new Error('cuota'), { status: 429 });
          throw unavailable();
        },
      },
    };
    return { sdk, calls };
  }

  it('reintenta con espera exponencial y termina bien (503, 503, ok)', async () => {
    const { sdk, calls } = scripted({ principal: ['503', '503', 'ok'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', sdk, sleep: async (ms) => void waits.push(ms), random: () => 0 });
    const message = await client.generate(request);
    assert.deepEqual(calls, ['principal', 'principal', 'principal']);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(message.parts[0]?.kind, 'text');
  });

  it('el retroceso tiene tope de 8 s y suma azar acotado', async () => {
    const { sdk } = scripted({ principal: ['503'] });
    const waits: number[] = [];
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', maxRetries: 6, retryBaseMs: 3000, sdk, sleep: async (ms) => void waits.push(ms), random: () => 0.999 });
    await assert.rejects(client.generate(request));
    assert.equal(waits.length, 6);
    assert.ok(waits.every((w) => w <= 8000 + 1500));
    assert.equal(waits[0], 3000 + Math.floor(0.999 * 1500));
  });

  it('agotados los reintentos => LLM_UNAVAILABLE (503) con intentos y sin tocar la clave', async () => {
    const { sdk, calls } = scripted({ principal: ['503'] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.equal(error.httpStatus, 503);
      assert.equal((error.details as { attempts: number }).attempts, 4);
      return true;
    });
    assert.equal(calls.length, 4);
  });

  it('con GEMINI_FALLBACK_MODEL prueba el alternativo tras agotar el principal', async () => {
    const { sdk, calls } = scripted({ principal: ['503'], respaldo: ['ok'] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['respaldo'], maxRetries: 1, sdk, sleep: async () => {} });
    await client.generate(request);
    assert.deepEqual(calls, ['principal', 'principal', 'respaldo']);
  });

  it('un modelo alternativo igual al principal se ignora; si ambos fallan sigue LLM_UNAVAILABLE', async () => {
    const same = scripted({ principal: ['503'] });
    await assert.rejects(new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['principal'], maxRetries: 0, sdk: same.sdk, sleep: async () => {} }).generate(request));
    assert.deepEqual(same.calls, ['principal']);

    const both = scripted({ principal: ['503'], respaldo: ['503'] });
    await assert.rejects(
      new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['respaldo'], maxRetries: 0, sdk: both.sdk, sleep: async () => {} }).generate(request),
      (error: unknown) => isAppError(error) && error.code === 'LLM_UNAVAILABLE',
    );
    assert.deepEqual(both.calls, ['principal', 'respaldo']);
  });

  it('429 reintenta pero no usa el modelo alternativo y acaba en RATE_LIMITED', async () => {
    const { sdk, calls } = scripted({ principal: ['429'], respaldo: ['ok'] });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', fallbackModels: ['respaldo'], maxRetries: 2, sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => isAppError(error) && error.code === 'RATE_LIMITED');
    assert.deepEqual(calls, ['principal', 'principal', 'principal']);
  });

  it('GEMINI_MAX_RETRIES=0 no reintenta; 404 y 400 nunca se reintentan', async () => {
    const none = scripted({ principal: ['503'] });
    await assert.rejects(new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'principal', maxRetries: 0, sdk: none.sdk, sleep: async () => {} }).generate(request));
    assert.equal(none.calls.length, 1);
  });

  it('la configuracion lee GEMINI_MAX_RETRIES, GEMINI_RETRY_BASE_MS y GEMINI_FALLBACK_MODEL', () => {
    const defaults = loadConfig({}).gemini;
    assert.deepEqual([defaults.maxRetries, defaults.retryBaseMs, defaults.fallbackModels, defaults.requestTimeoutMs], [3, 1000, [], 20000]);
    const custom = loadConfig({ GEMINI_MAX_RETRIES: '5', GEMINI_RETRY_BASE_MS: '250', GEMINI_FALLBACK_MODEL: ' a , b ,, ', GEMINI_REQUEST_TIMEOUT_MS: '5000' }).gemini;
    assert.deepEqual([custom.maxRetries, custom.retryBaseMs, custom.fallbackModels, custom.requestTimeoutMs], [5, 250, ['a', 'b'], 5000]);
    assert.throws(() => loadConfig({ GEMINI_REQUEST_TIMEOUT_MS: '10' }));
    assert.throws(() => loadConfig({ GEMINI_MAX_RETRIES: '99' }));
  });
});

describe('GoogleGenAiClient: timeout por intento y cadena de modelos', () => {
  const request = {
    systemInstruction: 's',
    messages: [{ role: 'user' as const, parts: [{ kind: 'text' as const, text: 'hola' }] }],
    tools: [],
    temperature: 0.4,
    maxOutputTokens: 64,
  };
  const okResponse = { candidates: [{ content: { parts: [{ text: 'listo' }] } }] } as unknown as Awaited<
    ReturnType<GenAiLike['models']['generateContent']>
  >;

  /** SDK por modelo: 'cuelga' no responde nunca; 'ok' responde; '503' falla. */
  function sdkWith(behavior: Record<string, 'cuelga' | 'ok' | '503'>): { sdk: GenAiLike; calls: string[] } {
    const calls: string[] = [];
    const sdk: GenAiLike = {
      models: {
        generateContent: (params) => {
          const model = (params as { model: string }).model;
          calls.push(model);
          const mode = behavior[model] ?? 'ok';
          if (mode === 'ok') return Promise.resolve(okResponse);
          if (mode === 'cuelga') return new Promise(() => undefined);
          return Promise.reject(Object.assign(new Error('UNAVAILABLE'), { status: 503 }));
        },
      },
    };
    return { sdk, calls };
  }

  it('un intento que excede el tiempo maximo no se reintenta y pasa al siguiente modelo', async () => {
    const { sdk, calls } = sdkWith({ lento: 'cuelga', rapido: 'ok' });
    const started = Date.now();
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'lento', fallbackModels: ['rapido'], requestTimeoutMs: 40, sdk, sleep: async () => {} });
    const message = await client.generate(request);
    assert.deepEqual(calls, ['lento', 'rapido']);
    assert.equal(message.parts[0]?.kind, 'text');
    assert.ok(Date.now() - started < 1000);
  });

  it('cadena de varios modelos en orden; si todos fallan => LLM_UNAVAILABLE con modelsTried', async () => {
    const { sdk, calls } = sdkWith({ a: '503', b: 'cuelga', c: '503' });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'a', fallbackModels: ['b', 'c', 'a'], maxRetries: 0, requestTimeoutMs: 30, sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.deepEqual((error.details as { modelsTried: string[] }).modelsTried, ['a', 'b', 'c']);
      return true;
    });
    assert.deepEqual(calls, ['a', 'b', 'c']);
  });

  it('solo timeout en un unico modelo => LLM_UNAVAILABLE con timedOut:true', async () => {
    const { sdk } = sdkWith({ x: 'cuelga' });
    const client = new GoogleGenAiClient({ apiKey: AQ_KEY, model: 'x', requestTimeoutMs: 30, sdk, sleep: async () => {} });
    await assert.rejects(client.generate(request), (error: unknown) => {
      assert.ok(isAppError(error));
      assert.equal((error.details as { timedOut: boolean }).timedOut, true);
      return true;
    });
  });
});
`],
  ["README.md", `# Bot Ecommerce TECS Acarigua

Asistente comercial omnicanal con IA (Gemini + Node.js/TypeScript/Express) para la tienda TECS (Acarigua).
Atiende WhatsApp, Instagram DM y Mercado Libre, filtra consultas vagas, arma cotizaciones de PC paso a paso
en memoria y concreta visitas en la tienda fisica. Arquitectura dual: \`ODOO_MODE=mock | live\`.

## Inicio rapido (modo demo, sin Odoo)

\`\`\`bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env y define GEMINI_API_KEY
npm run dev
\`\`\`

Prueba el asistente sin WhatsApp:

\`\`\`bash
curl -s localhost:3000/api/chat -H "content-type: application/json" \\
  -d '{"message":"Quiero armar una PC para jugar, tengo 800 dolares"}'
\`\`\`

La respuesta incluye un \`sessionId\`: reenvialo para continuar la conversacion. Con \`"channel":"mercadolibre"\` se
prueban las politicas de seguridad de ese canal. Si el armado de PC esta en curso, \`data.build\` trae su estado.

### Simulador web de demostracion

Abre **http://localhost:3000/demo/** para chatear desde el navegador: elige canal (WhatsApp, Instagram, Mercado Libre),
usa las pruebas rapidas y mira en vivo como la IA va llenando el armado de PC y calculando el montaje. Si defines
\`CHAT_API_KEY\`, la pagina pide la clave en un modal y la envia en \`x-api-key\`. Desactivalo con \`DEMO_ENABLED=false\`.

### Si el servidor dice "GEMINI_API_KEY no configurada"

1. Al arrancar, el log indica si cargo un \`.env\` (\`Archivo .env cargado\`, con su ruta) o dónde lo buscó. El \`.env\` debe estar en la
   raíz del proyecto (junto a \`package.json\`), con una línea \`GEMINI_API_KEY=AQ.Ab...\` (sin comillas ni espacios).
2. Con la clave detectada verás \`Gemini configurado\` con su origen, longitud y los 3 primeros caracteres (nunca la clave completa).
3. Las variables del entorno (p. ej. \`$env:GEMINI_API_KEY="..."\` en PowerShell) tienen prioridad sobre \`.env\`, pero solo valen para esa
   ventana de PowerShell: arranca \`npm run dev\` en la misma ventana. Si la variable existe pero está vacía, se usa la del \`.env\`.
4. Se aceptan claves \`AQ.Ab...\` y \`AIza...\`; no se valida el formato. Si Google la rechaza (401/403) la respuesta es \`LLM_AUTH_ERROR\`:
   copia la clave completa y confirma que su proyecto tiene habilitada la API de Gemini.
4b. Si el log muestra \`LLM_MODEL_ERROR\` (404), el modelo ya no existe para tu cuenta: cambia \`GEMINI_MODEL\` en \`.env\` (por defecto \`gemini-3.8-flash\`) y reinicia.
4c. \`LLM_UNAVAILABLE\` (503) = Gemini con alta demanda temporal: el servidor ya reintenta solo (\`GEMINI_MAX_RETRIES\`, \`GEMINI_RETRY_BASE_MS\`); puedes definir \`GEMINI_FALLBACK_MODEL\` (uno o varios modelos separados por coma) como respaldo; \`GEMINI_REQUEST_TIMEOUT_MS\` limita cada intento. Para saber qué modelos responden con tu clave: \`node probe-models.js modelo1 modelo2\`.
5. Tras editar \`.env\`, reinicia \`npm run dev\` (el modo watch no vigila archivos que empiezan con punto).
6. Evita crear el \`.env\` con \`echo ... > .env\` de PowerShell (genera UTF-16); el cargador lo tolera y avisa, pero guárdalo como UTF-8.

## Despliegue con Docker (llave en mano)

Requisitos: Docker con Compose v2 y \`bash\`/\`curl\` (Linux, macOS o WSL). En el servidor de TECS:

\`\`\`bash
chmod +x install.sh   # solo si el bit de ejecucion se perdio (git update-index --chmod=+x install.sh)
./install.sh          # asistente interactivo; --yes usa los valores existentes/por defecto, --no-start solo escribe .env
\`\`\`

El asistente pide la clave de Gemini, el modo (\`mock\` o \`live\` con datos de Odoo), los datos de la tienda, genera
\`CHAT_API_KEY\`, escribe \`.env\` (permisos 600, con copia \`.env.bak\`), construye la imagen, levanta el contenedor y
espera a que \`/health\` responda \`ok\`. Es idempotente: puedes volver a correrlo para cambiar valores.

| Elemento | Detalle |
| --- | --- |
| \`Dockerfile\` | Multi-stage (deps, build, prod-deps, runtime). Copia \`dist/\`, \`data/\` y \`public/\`; corre como usuario \`node\` con \`HEALTHCHECK\` en \`/health\`. |
| \`docker-compose.yml\` | Red propia \`tecs_net\`, raiz de solo lectura, \`cap_drop: ALL\`, \`no-new-privileges\`, limites de memoria/procesos, rotacion de logs de Docker. |
| Persistencia | \`./storage/leads\` (leads del modo mock) y \`./storage/logs\` (\`app-AAAA-MM-DD.log\`, rotacion diaria, \`LOG_RETENTION_DAYS\`). |
| Puerto | \`127.0.0.1:3000\` por defecto (\`BIND_ADDRESS\`, \`HOST_PORT\`). Para Meta/Mercado Libre publica detras de un proxy HTTPS (no incluido). |

### Limite de tasa en \`/api/chat\`

Ventana fija por IP para proteger el consumo de Gemini: \`RATE_LIMIT_ENABLED\` (true), \`RATE_LIMIT_MAX\` (20) y
\`RATE_LIMIT_WINDOW_SECONDS\` (60). Al excederlo responde \`429\` con \`error.code = "RATE_LIMITED"\` y \`Retry-After\`.
Detras de un proxy inverso define \`TRUST_PROXY=1\` (numero de saltos); sin eso todos los clientes comparten la IP del proxy.
El contador vive en memoria de cada proceso. Prueba: \`for i in $(seq 25); do curl -s -o /dev/null -w "%{http_code} " localhost:3000/api/chat -H "content-type: application/json" -d '{"message":"hola"}'; done\`.

## Arquitectura

| Capa | Ubicacion | Responsabilidad |
| --- | --- | --- |
| Datos (patron adaptador) | \`src/repositories\` | \`IInventoryRepository\` + \`MockRepository\` (JSON local) + \`OdooRepository\` (XML-RPC) |
| Negocio | \`src/services\` | Curaduria (max. 3 opciones, desambiguacion), compatibilidad, motor de armado de PC, sesiones |
| IA | \`src/ai\` | Prompt del sistema, declaracion/ejecucion de herramientas, bucle de Function Calling con Gemini, filtro de salida por canal |
| Demo | \`public/demo\` | Simulador web (HTML/CSS/JS vanilla, sin dependencias) |
| Canales | \`src/channels\` | WhatsApp Cloud API, Instagram DM, Mercado Libre (webhooks + envio) |
| HTTP | \`src/app.ts\`, \`src/routes\` | Express: \`/health\`, \`/api/chat\` (+ \`/config\`, \`/reset\`), \`/webhooks/*\`, \`/demo\`; errores \`{ success:false, error:{ code, message, details } }\` |

## Pasar a Odoo real (\`ODOO_MODE=live\`)

1. Define \`ODOO_URL\`, \`ODOO_DB\`, \`ODOO_USERNAME\` y \`ODOO_PASSWORD\` (API key del usuario de integracion).
2. Apps instaladas en Odoo Community: Inventario, Ventas y CRM. Productos **almacenables** (con seguimiento de inventario).
3. Categorias de producto con los nombres de \`DEFAULT_CATEGORY_MAP\` (\`src/config/env.ts\`) o su equivalente en \`ODOO_CATEGORY_MAP\`.
4. Especificaciones tecnicas en \`description_sale\`, una por linea (\`clave: valor\`):

\`\`\`text
socket: AM4
memory_type: DDR4
form_factors: |ATX|mATX|ITX|
tdp_w: 65
igpu: si
tags: gaming, economico
summary: Frase corta para el cliente
\`\`\`

\`formatSpecText\` (\`src/repositories/odoo/specs.ts\`) genera este texto desde el catalogo mock para migrar los productos.

## Pruebas

\`\`\`bash
npm run typecheck
npm test
\`\`\`
`],
  ["CHANGELOG_SESSION.md", `# CHANGELOG_SESSION

Rama de trabajo: \`development\`. Cada sesión se aplica con \`node apply-update.js\` en la raíz del proyecto
(\`--dry-run\` muestra qué haría sin escribir). El \`apply-update.js\` de cada sesión contiene **solo** los archivos
creados o modificados en ella.

---

## Sesión 7 (corrección) — Tiempo máximo por intento y cadena de modelos de respaldo (2026-11-21)

Se aplica con \`node patch-07-timeout-y-respaldos.js\` (sobre los parches anteriores).

**Diagnóstico con \`probe-models.js\` (clave real del usuario):** \`gemini-3.8-flash\` sin respuesta en 30 s; \`gemini-3.6-flash\` FUNCIONA (4,7 s);
\`gemini-flash-latest\` 429 \`RESOURCE_EXHAUSTED\` (cuota agotada). El 403 anterior del \`curl\` fue por \`$env:GEMINI_API_KEY\` vacío en esa ventana
de PowerShell, no por la clave. Conclusión: el modelo 3.8 está saturado de forma intermitente; el 3.6 responde.

**Cambios:** \`src/ai/GoogleGenAiClient.ts\`, \`src/config/env.ts\`, \`src/container.ts\`, \`.env.example\`, \`README.md\`,
\`tests/dotenv-and-gemini-key.test.ts\` (+3 pruebas), este archivo.

1. **Tiempo máximo por intento** (\`GEMINI_REQUEST_TIMEOUT_MS\`, 20000): el intento se aborta (\`AbortController\`) y falla como 504 interno.
   **Un timeout no se reintenta en el mismo modelo** (ya costó todo el tiempo) y pasa al siguiente modelo; así el peor caso ya no son minutos.
2. **Cadena de respaldos:** \`GEMINI_FALLBACK_MODEL\` ahora admite varios modelos separados por coma, en orden (renombrado internamente a \`fallbackModels\`).
   Se pasa al siguiente ante 500/502/503/504 o timeout; nunca ante 429, 401/403, 404 ni 400. Duplicados ignorados.
3. \`LLM_UNAVAILABLE\` ahora incluye \`modelsTried\` y \`timedOut\` en \`details\`.

### Variables de entorno

| Variable | Defecto | Uso |
| --- | --- | --- |
| \`GEMINI_REQUEST_TIMEOUT_MS\` | \`20000\` | Tiempo máximo por intento (1000..120000) |
| \`GEMINI_FALLBACK_MODEL\` | vacío | Ahora lista separada por comas |

**Configuración recomendada según el diagnóstico (no cambia el código):** \`GEMINI_MODEL=gemini-3.6-flash\` y, si quieres,
\`GEMINI_FALLBACK_MODEL=gemini-3.8-flash\`. El 429 de \`gemini-flash-latest\` indica cuota agotada en el nivel de la cuenta: no sirve de respaldo.

**Verificado:** \`tsc\` sin errores; 216 de 216 pruebas; mutación: 3 regresiones, 3 detectadas. **No verificado:** el comportamiento
real de \`abortSignal\` en \`@google/genai\` (en las pruebas el SDK es un doble; el temporizador aborta igualmente la espera).
Pendiente sugerido: responder 200 a Meta de inmediato y procesar el mensaje de WhatsApp/Instagram en segundo plano.

---

## Sesión 6 (corrección) — Alta demanda de Gemini (503): reintentos y modelo de respaldo (2026-11-21)

Se aplica con \`node patch-06-reintentos-gemini.js\` (sobre los parches anteriores).

**Síntoma (log del usuario):** tras corregir el modelo, la primera consulta fallaba con \`503 UNAVAILABLE: This model is currently
experiencing high demand\`. No es un error de clave ni de configuración: es saturación temporal del servicio de Google. El código solo
reintentaba **una vez** a los 800 ms, poco para una saturación que dura segundos.

**Cambios:** \`src/ai/GoogleGenAiClient.ts\`, \`src/config/env.ts\`, \`src/container.ts\`, \`src/utils/errors.ts\`, \`.env.example\`, \`README.md\`,
\`tests/dotenv-and-gemini-key.test.ts\` (+8 pruebas), este archivo.

1. **Reintentos con retroceso exponencial** ante 429/500/502/503/504: 1 s, 2 s, 4 s (tope 8 s) más hasta 50 % de azar; por defecto 3 reintentos
   (peor caso ≈ 7–9 s extra, por debajo del tiempo de espera de 120 s del simulador). Cada reintento se registra como \`warn\`.
2. **Modelo de respaldo opcional** (\`GEMINI_FALLBACK_MODEL\`, vacío por defecto): si el principal sigue con error de servidor tras los reintentos,
   se prueba el de respaldo. No se usa con 429, 401/403, 404 ni 400 (cambiar de modelo no los arregla). No hay valor por defecto porque no
   pude verificar qué modelo ofrece tu cuenta.
3. **Error nuevo \`LLM_UNAVAILABLE\`** (HTTP 503, mensaje amable, \`details\`: \`status\`, \`model\`, \`attempts\`, \`cause\`) cuando se agotan los intentos;
   antes era un \`LLM_ERROR\` 502 genérico. El 429 sigue siendo \`RATE_LIMITED\`.

### Variables de entorno nuevas

| Variable | Defecto | Uso |
| --- | --- | --- |
| \`GEMINI_MAX_RETRIES\` | \`3\` | Reintentos ante alta demanda (0..6; 0 = sin reintentos) |
| \`GEMINI_RETRY_BASE_MS\` | \`1000\` | Espera base en ms del retroceso exponencial (0..30000) |
| \`GEMINI_FALLBACK_MODEL\` | vacío | Modelo alternativo ante fallos de servidor persistentes |

**Verificado:** \`tsc\` sin errores; 213 de 213 pruebas (guion de fallos 503/429, esperas exactas, tope, intentos, respaldo, configuración);
mutación: 4 regresiones, 4 detectadas. **No verificado:** el comportamiento real de Google bajo carga; si el 503 persiste minutos, ningún
reintento lo resuelve (conviene un \`GEMINI_FALLBACK_MODEL\` vigente de tu cuenta, o reintentar más tarde).

---

## Sesión 5 (corrección) — Modelo de Gemini retirado (404) (2026-11-21)

Se aplica con \`node patch-05-modelo-gemini.js\` (sobre los parches anteriores).

**Causa del \`LLM_ERROR\`** (ahora visible gracias al patch-04): Google respondió \`404 NOT_FOUND\` — \`models/gemini-2.5-flash\` ya no está
disponible para cuentas nuevas y recomienda \`gemini-3.8-flash\`. La clave \`AQ.\` funciona; el modelo del \`.env\` era el problema.

**Cambios:** \`src/config/env.ts\` (\`DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'\`), \`src/ai/GoogleGenAiClient.ts\` y \`src/utils/errors.ts\`
(un 404 ahora es \`LLM_MODEL_ERROR\`, 502, con el modelo y la pista de qué cambiar), \`.env.example\` (\`GEMINI_MODEL=gemini-3.8-flash\` y
nota), \`tests/dotenv-and-gemini-key.test.ts\` (+1), \`tests/packaging.test.ts\` (el mensaje de fallo ahora nombra las variables que faltan en
\`.env.example\`), \`README.md\`. Sin variables nuevas. **Acción del usuario:** el \`GEMINI_MODEL\` de su \`.env\` manda sobre el
valor por defecto: debe cambiarlo a \`gemini-3.8-flash\` (o quitar la línea) y reiniciar.

**Prueba fallida reportada** (\`packaging.test.ts\`: "GEMINI_API_KEY" sin documentar en \`.env.example\`): la prueba exige una línea
\`GEMINI_API_KEY=\` en \`.env.example\` porque \`install.sh\` la escribe. Con los archivos entregados pasa (205/205 aquí; también con CRLF/BOM),
así que el \`.env.example\` local no tiene esa línea al inicio de renglón (editado a mano, sin aplicar el parche o con la clave en otro formato).
**No pude reproducirlo ni confirmar la causa.** Comprobar: \`findstr /B "GEMINI_API_KEY" .env.example\`.

**Verificado:** \`tsc\` sin errores, 205 de 205 pruebas. **No verificado:** que \`gemini-3.8-flash\` funcione con la clave del usuario
(nombre tomado del mensaje de error de Google) ni con Function Calling real.

---

## Sesión 4 (corrección) — Ver la causa real de \`LLM_ERROR\` en los logs (2026-11-21)

Se aplica con \`node patch-04-log-errores-llm.js\` (sobre los dos parches de la sesión 3).

**Síntoma:** con la clave ya detectada (\`Gemini configurado\`, \`keyPrefix: "AQ."\`), el log mostraba solo \`LLM_ERROR: Fallo la consulta al
modelo de IA\`. **Causa de ese silencio:** el logger serializaba los errores únicamente con \`name\`, \`message\` y \`stack\`, y descartaba
\`code\` y \`details\`, que es donde \`GoogleGenAiClient\` guarda el estado HTTP y el mensaje que devolvió Google. No es un fallo de la clave:
un 401/403 saldría como \`LLM_AUTH_ERROR\`, así que el rechazo fue de otro tipo (modelo, petición o red).

**Cambios:** \`src/utils/logger.ts\` (los errores ahora incluyen \`code\`, \`details\` y \`cause\`, con las claves sensibles aún en \`[REDACTED]\`),
\`src/ai/GoogleGenAiClient.ts\` (la causa guardada sube de 300 a 800 caracteres), \`tests/error-logging.test.ts\` (2 pruebas),
este archivo. Sin variables nuevas. \`tsc\` sin errores y 204 de 204 pruebas.

**No verificado:** la causa concreta del \`LLM_ERROR\` del usuario; sin acceso a su clave ni a Google no se puede determinar desde aquí.
Siguiente paso: reiniciar, repetir el mensaje y leer \`error.details.status\` y \`error.details.cause\` en el log.

---

## Sesión 3 (corrección) — Clave de Gemini y carga de \`.env\` en Windows (2026-11-18)

Se aplica con \`node patch-03-fix-gemini-env.js\` (requiere el \`patch-03-docker-produccion.js\` ya aplicado).

### Diagnóstico

- **No existe validación de prefijo ni longitud de la clave** en \`env.ts\`, \`container.ts\`, \`GeminiService.ts\` ni \`GoogleGenAiClient.ts\`:
  \`AQ.Ab...\` no se rechazaba por su formato. El aviso sale cuando \`config.gemini.apiKey\` llega \`null\`, o sea, cuando el proceso no ve
  la variable al cargar la configuración (\`GeminiService.ts:52\` solo lanza \`LLM_NOT_CONFIGURED\`).
- **Causa reproducida: \`.env\` guardado con BOM UTF-8 o en UTF-16** (Bloc de notas, PowerShell 5.1 con \`-Encoding utf8\`, \`echo ... > .env\`).
  \`process.loadEnvFile\` dejaba la primera variable con el nombre \`"\\uFEFFGEMINI_API_KEY"\` (BOM UTF-8) o no leía nada (UTF-16), **sin avisar**.
- **No reproducible aquí:** una variable puesta con \`$env:GEMINI_API_KEY\` en PowerShell sí llega al proceso (Node la prioriza sobre \`.env\`).
  Si aun así falla, lo más probable es que el servidor se arrancara en otra ventana/terminal (la variable \`$env:\` solo vive en esa
  ventana) o que quedara un proceso viejo en el puerto. El nuevo log de arranque lo aclara (ver abajo).
- Orden de carga correcto: \`loadDotEnv()\` ya corría antes de \`loadConfig()\`; \`npm run dev\` y \`npm start\` pasan ambos por \`server.ts\`.

### Cambios

**Nuevos:** \`src/config/dotenv.ts\` (cargador propio sin dependencias), \`tests/dotenv-and-gemini-key.test.ts\` (19 pruebas)

**Modificados:** \`src/config/env.ts\`, \`src/container.ts\`, \`src/server.ts\`, \`src/ai/GoogleGenAiClient.ts\`, \`src/utils/errors.ts\`,
\`.env.example\`, \`README.md\` (sección de diagnóstico), este archivo.

1. **Cargador de \`.env\` propio** (\`dotenv.ts\`): detecta UTF-8, UTF-8 con BOM, UTF-16 LE/BE (con y sin BOM), CRLF, comillas simples/dobles,
   \`export\`, comentarios; \`$\` es literal. Busca \`.env\` en la carpeta de trabajo y luego en la raíz del proyecto, así que funciona aunque
   \`npm run dev\` se lance desde otra carpeta. Prioridad: variable de entorno **con valor** > \`.env\`; una variable definida pero **vacía** se
   rellena desde \`.env\`. Nunca lanza excepciones ni registra valores.
2. **Clave de Gemini** (\`resolveGeminiKey\`): limpia comillas, espacios y caracteres invisibles; **no valida prefijo ni longitud**
   (acepta \`AQ.Ab...\`, \`AIza...\` y formatos futuros); acepta \`GOOGLE_API_KEY\` como alternativa si \`GEMINI_API_KEY\` está vacía; avisa si
   la clave tiene espacios internos o parece un ejemplo.
3. **Diagnóstico al arrancar** (sin exponer la clave): \`Archivo .env cargado\` (ruta, codificación, nº de variables) o \`No hay archivo .env\`
   (rutas buscadas); \`Gemini configurado\` (origen, longitud, 3 primeros caracteres); avisos si el \`.env\` tenía problemas.
4. **\`GoogleGenAiClient\`**: \`new GoogleGenAI({ apiKey, vertexai: false })\` para que variables como \`GOOGLE_GENAI_USE_VERTEXAI\` no desvíen
   la llamada; un 401/403 de Google ahora es \`LLM_AUTH_ERROR\` (502) con pista, sin reintento; antes era un \`LLM_ERROR\` genérico.
   Se añadió la opción \`sdk\` (solo pruebas).

### Variables de entorno

Sin variables obligatorias nuevas. \`GOOGLE_API_KEY\` se reconoce como alternativa opcional a \`GEMINI_API_KEY\`.

### Verificación realizada

- \`tsc\` estricto sin errores; **202 de 202** pruebas (19 nuevas): BOM, UTF-16, CRLF, comillas, precedencia entorno/\`.env\`, búsqueda
  de rutas, claves \`AQ.\`/\`AIza\`, flujo \`.env\` → \`loadConfig\`, 401/403 → \`LLM_AUTH_ERROR\`, informes sin valores.
- Mutación: 6 regresiones introducidas; 5 detectadas y 1 equivalente (el BOM se quita dos veces, es defensa redundante).

### Lo que NO se pudo verificar

- **Con una clave real contra Google:** aquí no hay red hacia la API ni \`@google/genai\` real (solo tipos de apoyo). Según la documentación y
  reportes de Google, las claves \`AQ.\` funcionan con el endpoint nativo de Gemini vía \`x-goog-api-key\` (lo que usa el SDK) y fallan con
  \`Authorization: Bearer\`; también hay reportes de 401 \`ACCESS_TOKEN_TYPE_UNSUPPORTED\` por clave truncada o proyecto sin la API habilitada.
- **Tu PowerShell:** no pude reproducir el fallo con \`$env:\`; si persiste tras el parche, copia las 3 líneas del log (\`Archivo .env…\`,
  \`Gemini configurado\`/aviso) para ubicarlo.
- **\`tsx watch --include .env\`:** probé reiniciar el modo watch al cambiar \`.env\`, pero no lo hace (ignora archivos con punto), así que
  **no se incluyó**: tras editar \`.env\`, reinicia \`npm run dev\`.
- Si ves \`LLM_AUTH_ERROR\`, considera actualizar \`@google/genai\` (\`npm i @google/genai@latest\`); no lo toqué por no poder probarlo aquí.

---

## Sesión 3 — Empaquetado Docker de producción y límite de tasa (2026-11-18)

Se aplica con \`node patch-03-docker-produccion.js\` (misma mecánica que \`apply-update.js\`; \`--dry-run\` disponible).
Requiere las sesiones 1 y 2.

### Archivos

**Nuevos:** \`Dockerfile\`, \`docker-compose.yml\`, \`install.sh\` (modo 755), \`.dockerignore\`, \`.gitattributes\`,
\`src/middleware/rateLimit.ts\`, \`src/utils/fileLogSink.ts\`, \`tests/rate-limit.test.ts\`, \`tests/file-logging.test.ts\`,
\`tests/packaging.test.ts\`, \`tests/installer.test.ts\`

**Modificados:** \`src/app.ts\` (trust proxy + limitador), \`src/routes/chat.routes.ts\` (limitador solo en \`POST /api/chat\`),
\`src/config/env.ts\`, \`src/server.ts\` (log a archivo), \`src/utils/logger.ts\` (sink opcional), \`public/demo/index.html\`
(mensaje amable ante \`RATE_LIMITED\`), \`.env.example\`, \`.gitignore\` (\`storage/\`, \`.env.bak\`), \`README.md\`, este archivo.

### Variables de entorno nuevas

| Variable | Defecto | Uso |
| --- | --- | --- |
| \`RATE_LIMIT_ENABLED\` | \`true\` | Activa el límite por IP en \`/api/chat\` |
| \`RATE_LIMIT_MAX\` | \`20\` | Peticiones por ventana (1..100000) |
| \`RATE_LIMIT_WINDOW_SECONDS\` | \`60\` | Ventana en segundos (1..86400) |
| \`TRUST_PROXY\` | \`0\` | Saltos de proxy confiables para leer \`X-Forwarded-For\` (0..10) |
| \`LOG_DIR\` | vacío | Carpeta de logs diarios (en Docker: \`/app/storage/logs\`) |
| \`LOG_RETENTION_DAYS\` | \`14\` | Días de logs que se conservan |
| \`HOST_PORT\`, \`BIND_ADDRESS\` | \`3000\`, \`127.0.0.1\` | Solo Docker: puerto y dirección publicados |
| \`APP_UID\`, \`APP_GID\`, \`TZ\` | \`1000\`, \`1000\`, \`America/Caracas\` | Solo Docker: dueño de \`storage/\` y zona horaria |

### Decisiones de diseño

- **Imagen**: 4 etapas; solo dependencias de producción, sin tests ni \`.env\`; usuario no-root; \`HEALTHCHECK\` a \`/health\`.
- **Red**: \`tecs_net\` propia (no \`internal\`, porque Gemini, Meta y Mercado Libre requieren salida). Aislamiento por
  raíz de solo lectura, \`cap_drop: ALL\`, \`no-new-privileges\`, \`tmpfs /tmp\` (\`mode=1777,noexec,nosuid\`), límites de memoria/procesos.
- **Persistencia**: bind mounts \`./storage/leads\` y \`./storage/logs\`; el instalador los crea con el UID correcto.
- **Límite de tasa**: ventana fija en memoria; IPv6 agrupado por /64; responde \`429 RATE_LIMITED\` con \`Retry-After\` y
  \`RateLimit-*\`. Se evalúa antes de autenticar. \`/reset\`, \`/config\` y webhooks no se limitan.
- **Logs**: si la carpeta no se puede crear, el servidor sigue solo con stdout; un fallo de escritura nunca tumba la app.
- **\`.env\`**: el instalador escribe \`CLAVE='valor'\` para que ni Compose ni Node interpolen \`$\`.

### Verificación realizada

- \`tsc\` estricto sin errores; suite completa de pruebas en verde (incluye pruebas nuevas de límite, logs, empaquetado e instalador).
- Pruebas de mutación sobre el limitador y la retención de logs: todas detectadas.
- \`docker compose config\` y \`docker build --check\` sin avisos; el Dockerfile real construyó contra una imagen base local.
- Contenedor con las banderas de Compose y UID arbitrario: \`/app\` y \`/etc\` de solo lectura, \`storage\` y \`/tmp\` escribibles.
- Instalador probado con \`docker\` simulado (interactivo, \`--yes\`, modo live, canales, validaciones, fallos).
- El parche se verificó sobre copia limpia: simulación, aplicación, segunda corrida idempotente y contenido idéntico.

### Lo que NO se pudo verificar

- \`npm ci\` real dentro del build ni la descarga de \`node:22-alpine\` (sin acceso a Docker Hub aquí).
- Comportamiento con Express real detrás de un proxy, ni llamadas reales a Gemini.

### Notas y pendientes

- El limitador es por proceso: con varias réplicas, cada una cuenta aparte. Con Docker Desktop o proxy sin \`TRUST_PROXY\`
  todos comparten una IP.
- Falta el proxy HTTPS (Caddy/nginx) para exponer los webhooks de Meta y Mercado Libre.
- Si el bit de ejecución se pierde al clonar: \`git update-index --chmod=+x install.sh\`.
- Primera prueba del 429: ver el bucle \`curl\` en el README.

---

## Sesión 2 — Simulador web de chat para demostración (2026-11-17)

Página de demostración en \`http://localhost:3000/demo/\` (HTML + CSS + JS vanilla en un solo archivo, sin frameworks
ni CDNs) para mostrarle al dueño de TECS cómo atiende el asistente y cómo se arma una PC paso a paso.

### Qué incluye el simulador

1. **App de mensajería** con identidad TECS (barra azul marino, acento naranja, logotipo de texto), burbujas
   por canal (verde WhatsApp, degradado Instagram, amarillo Mercado Libre), indicador de escritura, errores con
   botón **Reintentar** y diseño adaptable: en escritorio el panel va al lado; en móvil es un cajón deslizable
   con insignia de progreso (\`3/7\`) en el botón.
2. **Selector de canal** (\`whatsapp | instagram | mercadolibre\`) en la barra superior; envía \`channel\` a
   \`POST /api/chat\`. Cada conversación genera un \`sessionId\` propio (\`demo-<16 hex>\`). **Nueva conversación**
   libera la sesión anterior en el servidor (\`POST /api/chat/reset\`) y abre otra. Cambiar de canal también abre
   una conversación nueva (el servidor guarda el estado por canal + sessionId; mezclar canales confundiría el historial).
3. **Pruebas rápidas** (plegables): armado (“Quiero armar una PC gamer de $800”, oficina, edición, “Muéstrame
   cómo va mi armado”), consultas (“¿Qué cases tienen?”, “Busco una laptop”, “¿Tienen Ryzen 5 5600G?”,
   “¿Tienen Ryzen 7 5700X?” — agotado a propósito) y seguridad de canal (dirección y teléfono, para probar el filtro
   de Mercado Libre). **Visor del armado en vivo**: propósito, presupuesto, barra de gasto, los 7 pasos
   (hecho / siguiente / omitido), compatibilidad (errores y avisos), servicios de ensamblaje, total, diferencia
   contra el presupuesto, tiempo de entrega y el JSON completo. Lo recién elegido se resalta.
4. **\`CHAT_API_KEY\`**: la página consulta \`GET /api/chat/config\`; si el servidor exige clave, abre un modal
   (\`<dialog>\`) para ingresarla, la guarda en \`localStorage\` y la envía en \`x-api-key\`. Ante un \`401\` reabre el
   modal y reenvía el mensaje pendiente al guardar. Un botón con candado permite cambiarla o quitarla.
5. Casilla **“Ver detalle técnico”**: muestra las herramientas que usó el modelo por mensaje y los SKU.

### Archivos

**Nuevos:** \`public/demo/index.html\`, \`src/routes/chat.handlers.ts\`, \`tests/demo-simulator.test.ts\`, \`tests/helpers/fakeLlm.ts\`

**Modificados:** \`src/app.ts\` (sirve \`/demo\` con \`express.static\`, CSP y \`nosniff\`), \`src/routes/chat.routes.ts\`
(ahora delgado: delega en \`chat.handlers.ts\`), \`src/services/ConversationService.ts\` (\`build\` en el resultado + \`reset\`),
\`src/services/PCBuildEngine.ts\` (\`view()\` y tipo \`PCBuildView\`), \`src/container.ts\` (inyecta el motor a la conversación),
\`src/config/env.ts\` (\`DEMO_ENABLED\`), \`src/server.ts\` (log con la URL del demo), \`.env.example\`, \`README.md\`, \`CHANGELOG_SESSION.md\`

### Contrato HTTP (cambios)

| Ruta | Auth | Descripción |
| --- | --- | --- |
| \`GET /demo/\` | no | Simulador (solo si \`DEMO_ENABLED=true\`) |
| \`GET /api/chat/config\` | no | \`{ requiresApiKey, storeName, mode, geminiConfigured, maxMessageChars }\`. Nunca devuelve la clave |
| \`POST /api/chat\` | \`x-api-key\` si hay clave | **Nuevo campo \`data.build\`**: \`PCBuildView\` o \`null\` si no hay armado en curso |
| \`POST /api/chat/reset\` | \`x-api-key\` si hay clave | Body \`{ sessionId, channel? }\` → \`{ sessionId, channel, reset }\` (\`reset:false\` si ya no existía) |

\`data.build\` (\`PCBuildView\`): \`purpose\`, \`budgetUsd\`, \`selected[{category,sku,name,priceUsd}]\`, \`nextStep\`, \`remainingSteps\`,
\`gpuOptional\`, \`gpuSkipped\`, \`spentUsd\`, \`complete\`, \`services[]\`, \`subtotalUsd\`, \`servicesUsd\`, \`totalUsd\`, \`deliveryEta\`,
\`budgetDeltaUsd\`, \`issues[{code,severity,message,categories}]\`, \`updatedAt\`. Los servicios solo se suman al completar el armado.
Los errores siguen el formato \`{ success:false, error:{ code, message, details } }\`.

### Variables de entorno nuevas

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| \`DEMO_ENABLED\` | no | \`true\` | \`false\` desactiva \`/demo\`. Valor inválido ⇒ \`CONFIG_ERROR\` al arrancar |

(\`CHAT_API_KEY\` ya existía y ahora también protege \`/api/chat/reset\`.)

### Decisiones de diseño

- **Lógica fuera de Express:** \`chat.handlers.ts\` contiene funciones puras (\`handleChat\`, \`handleReset\`, \`getChatConfig\`);
  las rutas solo adaptan \`req\`/\`res\`. Así la autenticación, validación y forma de respuesta se probaron sin depender de Express.
- **La vista del armado es informativa:** si \`engine.view()\` falla (p. ej. Odoo caído al listar servicios), la respuesta al
  cliente sigue su curso con \`build: null\` y se registra un aviso.
- **Seguridad de la página:** todo el texto (incluidas las respuestas del modelo) se inserta como nodos de texto, nunca como HTML;
  CSP restrictiva (\`default-src 'none'\`, solo scripts/estilos en línea, \`connect-src 'self'\`); sin recursos externos.
  La clave de API vive solo en \`localStorage\` del navegador de quien la escribe.
- **Colores e identidad:** no se dispone del manual de marca de TECS; los colores son provisionales y están en variables CSS al
  inicio del archivo (\`--navy\`, \`--blue\`, \`--orange\`), y el logotipo es texto. Basta cambiarlos ahí.
- **Seguridad en producción:** \`/demo\` es una página estática pública; lo sensible es \`/api/chat\`. Sin \`CHAT_API_KEY\` esa ruta
  queda abierta (el servidor ya lo advierte al arrancar en producción). Para una instalación en producción sin demo: \`DEMO_ENABLED=false\`.

### Verificación realizada

- \`tsc\` estricto: 0 errores. **131 pruebas** (21 nuevas) pasan: vista del armado (vacío / en curso / completo / sin GPU),
  reinicio por canal + sessionId, fallo de la vista sin tumbar la respuesta, autenticación (4 claves inválidas), validación del
  cuerpo, \`debug\` según entorno, \`config\` sin filtrar la clave, \`DEMO_ENABLED\`, y revisiones estáticas del HTML (sin URLs externas,
  JS que compila, sin \`eval\`/HTML dinámico, ids existentes y únicos, categorías del visor = categorías del motor).
- Pruebas de mutación: 5 regresiones introducidas a propósito (reset que no borra, auth omitida, vista sin filtro de “sin armado”,
  \`build\` descartado, cabecera \`x-api-key\` cambiada); las 5 fueron detectadas.
- **Prueba de punta a punta en Chrome headless** contra los handlers reales (\`ConversationService\`, motor, catálogo mock) con un LLM
  simulado: armado completo de 7 pasos con total y servicios, cambio a Mercado Libre (teléfono y enlace eliminados), error 502 con
  “Reintentar”, nueva conversación, y flujo de clave (modal automático, clave errónea ⇒ modal con mensaje, clave correcta ⇒ reenvío
  automático, persistencia tras recargar, quitar clave). Escritorio 1280×820 y móvil 390×844 sin desbordamiento horizontal.
  **Con la CSP real activa: 0 violaciones ni errores de consola.**

### Lo que NO se pudo verificar

- **\`express.static\` y las cabeceras en \`app.ts\` con Express real** (sin red para \`npm install\`): se comprobó con tipos de apoyo y,
  para la página, con un servidor \`node:http\` que aplica la misma CSP. Primer paso: \`npm install && npm run dev\` y abrir \`/demo/\`.
- **Gemini real:** la prueba usó un modelo simulado; la latencia y el texto reales pueden variar (tiempo de espera del navegador: 120 s).
- **Navegadores:** probado en Chrome (escritorio y emulación móvil). No se probó en Safari ni Firefox.

### Pendientes / siguientes pasos sugeridos

1. \`Dockerfile\`, \`docker-compose.yml\`, \`install.sh\`: la imagen **debe copiar \`public/\`** además de \`dist/\` y \`data/\` (el servidor lo busca en \`<raíz>/public\`).
2. Límite de tasa por IP en \`/api/chat\` (protege el costo de Gemini; el simulador lo hace más fácil de alcanzar).
3. Logotipo y colores oficiales de TECS en el simulador.
4. Pendientes de la sesión 1 (abajo).

---

## Sesión 1 — Estructura base del backend (2026-11-17)

Rama de trabajo: \`development\` (partía solo con \`README.md\` y \`.gitignore\`).
Aplicar con \`node apply-update.js\` en la raíz del proyecto (\`--dry-run\` para ver qué haría sin escribir).

### Resumen

Backend completo en Node.js + TypeScript + Express con patrón adaptador \`ODOO_MODE=mock | live\`:
catálogo mock (35 productos + 3 servicios), \`MockRepository\`, \`OdooRepository\` (XML-RPC propio, sin dependencias),
servicio de Gemini con Function Calling, motor de armado de PC en memoria, adaptadores de canal
(WhatsApp, Instagram, Mercado Libre) y suite de pruebas.

### Archivos

**Modificados (ya existían):** \`README.md\` (reemplazado por guía de inicio), \`.gitignore\` (mismas 4 reglas + \`coverage/\` y archivos de leads mock).

**Raíz:** \`package.json\`, \`tsconfig.json\`, \`tsconfig.build.json\`, \`.env.example\`, \`CHANGELOG_SESSION.md\`

**Datos:** \`data/catalog.mock.json\`

**\`src/\` — arranque y HTTP:** \`server.ts\`, \`app.ts\`, \`container.ts\` (composición de dependencias), \`routes/{health,chat,webhooks}.routes.ts\`, \`middleware/errorHandler.ts\`

**\`src/config\`, \`src/types\`, \`src/utils\`:** \`config/env.ts\`, \`types/{domain,api,llm}.ts\`, \`utils/{errors,logger,text,validators}.ts\`

**\`src/repositories\` (patrón adaptador):** \`IInventoryRepository.ts\`, \`matching.ts\`, \`MockRepository.ts\`, \`index.ts\` (fábrica según \`ODOO_MODE\`), \`odoo/{xmlrpc,OdooClient,specs,OdooRepository}.ts\`

**\`src/services\` (lógica de negocio):** \`compatibility.ts\`, \`curation.ts\`, \`CatalogService.ts\`, \`PCBuildEngine.ts\`, \`SessionStore.ts\`, \`ConversationService.ts\`

**\`src/ai\`:** \`prompt.ts\`, \`tools.ts\`, \`ToolExecutor.ts\`, \`GeminiService.ts\`, \`GoogleGenAiClient.ts\`, \`history.ts\`, \`replyGuard.ts\`

**\`src/channels\`:** \`types.ts\`, \`WhatsAppAdapter.ts\`, \`InstagramAdapter.ts\`, \`MercadoLibreAdapter.ts\`, \`ChannelDispatcher.ts\`, \`metaSignature.ts\`, \`SeenCache.ts\`, \`http.ts\`, \`payload.ts\`

**\`tests/\`:** 7 archivos \`*.test.ts\` + \`helpers/{fixtures,fakeOdoo}.ts\` (servidor Odoo XML-RPC simulado)

### Variables de entorno

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| \`ODOO_MODE\` | no | \`mock\` | \`mock\` o \`live\` |
| \`ODOO_URL\`, \`ODOO_DB\`, \`ODOO_USERNAME\`, \`ODOO_PASSWORD\` | solo \`live\` | — | Conexión XML-RPC (password = API key) |
| \`ODOO_TIMEOUT_MS\` | no | \`15000\` | Timeout por llamada |
| \`ODOO_SPECS_FIELD\` | no | \`description_sale\` | Campo con las especificaciones \`clave: valor\` |
| \`ODOO_CATEGORY_MAP\` | no | ver \`env.ts\` | JSON categoría-bot → categoría Odoo |
| \`ODOO_CREATE_QUOTATION\` | no | \`false\` | Crear además \`sale.order\` borrador |
| \`MOCK_CATALOG_PATH\`, \`MOCK_LEADS_PATH\` | no | \`./data/...\` | Catálogo y leads del modo mock |
| \`GEMINI_API_KEY\` | para atender | — | Sin ella el servidor arranca y responde \`LLM_NOT_CONFIGURED\` |
| \`GEMINI_MODEL\`, \`GEMINI_TEMPERATURE\`, \`GEMINI_MAX_TOOL_ROUNDS\` | no | \`gemini-flash-latest\`, \`0.4\`, \`6\` | Modelo y bucle de herramientas |
| \`SESSION_TTL_MINUTES\`, \`SESSION_MAX_COUNT\`, \`SESSION_MAX_HISTORY_TURNS\` | no | \`120\`, \`5000\`, \`14\` | Memoria de sesiones |
| \`STORE_NAME\`, \`STORE_CITY\`, \`STORE_ADDRESS\`, \`STORE_HOURS\` | no | \`TECS\`, \`Acarigua, Portuguesa\`, vacío | Datos de tienda (dirección/horario solo salen en WhatsApp/Instagram) |
| \`BUILD_DELIVERY_ETA\` | no | \`24 a 48 horas hábiles tras confirmar el pago\` | Tiempo de entrega en cotizaciones |
| \`WHATSAPP_PHONE_NUMBER_ID\`, \`WHATSAPP_ACCESS_TOKEN\`, \`WHATSAPP_VERIFY_TOKEN\` | para ese canal | — | WhatsApp Cloud API |
| \`INSTAGRAM_ACCESS_TOKEN\`, \`INSTAGRAM_VERIFY_TOKEN\` | para ese canal | — | Instagram DM |
| \`META_APP_SECRET\` | **sí en producción** | — | Valida \`X-Hub-Signature-256\` |
| \`META_GRAPH_VERSION\` | no | \`v23.0\` | Versión del Graph API (verificar la vigente) |
| \`MERCADOLIBRE_ACCESS_TOKEN\`, \`_REFRESH_TOKEN\`, \`_CLIENT_ID\`, \`_CLIENT_SECRET\`, \`_SELLER_ID\` | para ese canal | — | Mercado Libre |
| \`CHAT_API_KEY\` | recomendada en producción | — | Protege \`POST /api/chat\` y \`POST /api/chat/reset\` (header \`x-api-key\`) |
| \`DEMO_ENABLED\` | no | \`true\` | Sirve el simulador web en \`/demo\` (sesión 2) |
| \`PORT\`, \`NODE_ENV\`, \`LOG_LEVEL\` | no | \`3000\`, \`development\`, \`info\` | Servidor |

### Decisiones de diseño que conviene conocer

- **Reglas comerciales aplicadas en código, no solo en el prompt:** consulta vaga ⇒ la herramienta responde \`NEEDS_CLARIFICATION\` con las preguntas y no consulta inventario; tope de 3 productos por mensaje (\`DISPLAY_LIMIT_REACHED\`) aunque el modelo encadene búsquedas; los repositorios filtran \`stock > 0\` y recortan a \`limit 5\`.
- **Excepciones deliberadas al filtro de stock** (documentadas en la interfaz): \`lookupByName\`/\`getProductBySku\` devuelven también agotados para poder decir "agotado" con precio exacto, y \`listServices\` (los servicios no tienen stock). Todas conservan el tope de 5.
- **Mercado Libre, defensa en tres capas:** prompt del canal + herramienta \`registrar_visita\` bloqueada + filtro de salida (\`replyGuard\`) que elimina teléfonos, correos, \`@usuarios\`, enlaces/dominios, direcciones y la dirección configurada.
- **Odoo sin dependencias:** códec XML-RPC propio (\`xmlrpc.ts\`) sobre \`fetch\`. Las especificaciones técnicas se leen de líneas \`clave: valor\` en \`description_sale\` y los filtros técnicos (socket, DDR, formato de case) se traducen a dominios \`ilike\`, de modo que el \`limit: 5\` se aplica del lado de Odoo.
- **Aislamiento del SDK:** todo el sistema habla con \`LlmClient\`; solo \`GoogleGenAiClient.ts\` importa \`@google/genai\`. Conserva \`thoughtSignature\` e \`id\` de las llamadas, requisito de los modelos Gemini 3.
- **Compatibilidad:** socket CPU/placa, DDR RAM/placa, formato placa/case, largo de GPU/case y potencia de fuente (TDP + 120 W). Si falta una especificación se emite advertencia, no bloqueo.
- **Presupuesto por paso:** reparto por propósito (gaming/creación/oficina) descontando servicios y redistribuyendo lo ya gastado; si nada cabe, ofrece las 2 más económicas marcadas \`overBudget\`.

### Verificación realizada

- \`tsc\` en modo estricto (\`strict\`, \`noUnusedLocals\`, \`noUnusedParameters\`): 0 errores; \`build\` emite \`dist/server.js\` y el CJS compilado carga.
- 110 pruebas en 22 suites: todas pasan. Incluyen paridad Mock vs Odoo (13 consultas, mismo orden de SKUs) contra un servidor Odoo XML-RPC simulado con evaluador de dominios, y el flujo completo de armado.
- Pruebas de mutación: 12 regresiones introducidas a propósito (quitar filtro de stock, tope de 3, filtro de teléfonos, firma de Meta, etc.), las 12 fueron detectadas.
- Exploración de 42 escenarios (3 propósitos × 7 presupuestos × elección primera/última): 0 callejones sin salida, 0 incompatibilidades.
- Revisión estática: sin \`any\`, sin residuos de otros proyectos, sin secretos, capas de negocio sin dependencia de implementaciones de datos.

### Lo que NO se pudo verificar (sin red para \`npm install\`)

- **Capa Express** (\`app.ts\`, \`routes/\`, \`middleware/\`): comprobada con tipos de apoyo locales, **no ejecutada contra \`express\` real**. Primer paso al instalar: \`npm install && npm run typecheck && npm test && npm run dev\`.
- **\`@google/genai\`**: tipado modelado desde la API pública, no compilado contra el paquete real ni probado contra la API de Gemini. Verifica \`GEMINI_MODEL\` (el alias \`gemini-flash-latest\` cambia de modelo con el tiempo; conviene fijar uno).
- **Odoo, WhatsApp, Instagram y Mercado Libre reales:** probados solo contra simulaciones. Los payloads siguen la documentación de cada plataforma, pero requieren una prueba de punta a punta con credenciales.
- **Catálogo:** modelos reales, pero precios, stock y varias especificaciones (p. ej. largo máximo de GPU de algunos cases) son **valores de demostración** a validar con la tienda.

### Pendientes / siguientes pasos sugeridos

1. \`Dockerfile\`, \`docker-compose.yml\`, \`install.sh\` (entrega "llave en mano").
2. Límite de tasa por usuario/IP (protege el costo de Gemini en \`/api/chat\` y webhooks).
3. Persistir el \`refresh_token\` de Mercado Libre (hoy solo vive en memoria tras renovarse).
4. Sesiones en Redis si se necesita más de una instancia (hoy son en memoria por diseño).
5. Script de migración que cargue \`catalog.mock.json\` a Odoo usando \`formatSpecText\`.
`],
];

// Archivos que deben quedar ejecutables en Linux/macOS
const EXECUTABLE = new Set([]);

function writeOne(relativePath, content) {
  const target = path.join(ROOT, ...relativePath.split('/'));
  const inside = path.relative(ROOT, target);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('ruta fuera del proyecto: ' + relativePath);
  }

  let status = 'CREADO';
  if (fs.existsSync(target)) {
    status = fs.readFileSync(target, 'utf8') === content ? 'SIN CAMBIOS' : 'ACTUALIZADO';
  }
  if (!DRY_RUN && status !== 'SIN CAMBIOS') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  if (!DRY_RUN && EXECUTABLE.has(relativePath) && process.platform !== 'win32') {
    try { fs.chmodSync(target, 0o755); } catch (e) { /* mejor esfuerzo */ }
  }
  return status;
}

function main() {
  console.log((DRY_RUN ? '[SIMULACION] ' : '') + 'Proyecto: ' + ROOT);
  const counts = { 'CREADO': 0, 'ACTUALIZADO': 0, 'SIN CAMBIOS': 0 };
  const failures = [];

  for (const [relativePath, content] of FILES) {
    try {
      const status = writeOne(relativePath, content);
      counts[status] += 1;
      if (status !== 'SIN CAMBIOS') console.log('  ' + status.padEnd(11) + ' ' + relativePath);
    } catch (error) {
      failures.push(relativePath);
      console.error('  ERROR       ' + relativePath + ': ' + (error && error.message ? error.message : error));
    }
  }

  console.log('');
  console.log(
    'Resumen: ' + counts['CREADO'] + ' creados, ' + counts['ACTUALIZADO'] + ' actualizados, ' +
    counts['SIN CAMBIOS'] + ' sin cambios, ' + failures.length + ' con error (de ' + FILES.length + ').'
  );

  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!DRY_RUN) {
    console.log('');
    console.log('Siguientes pasos:');
    console.log('  1. npm run typecheck && npm test');
    console.log('  2. reinicia npm run dev; en .env: GEMINI_MODEL=gemini-3.6-flash y opcional GEMINI_FALLBACK_MODEL=gemini-3.8-flash');
    console.log('Detalle de lo entregado: CHANGELOG_SESSION.md');
  }
}

main();
