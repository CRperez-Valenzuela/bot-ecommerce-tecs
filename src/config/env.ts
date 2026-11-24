import type { OdooMode, ProductCategory } from '../types/domain';
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
  /** Mensajes entrantes por webhook: agrupar rafagas y limite por cliente (el limite usa RATE_LIMIT_ENABLED). */
  messaging: {
    debounceMs: number;
    debounceMaxWaitMs: number;
    userRate: { enabled: boolean; max: number; windowSeconds: number };
  };
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
    /** Espera maxima (ms) ante un 429 de cuota por minuto en el ultimo modelo; si Google pide mas, se devuelve LLM_QUOTA. */
    quotaMaxWaitMs: number;
    /** Ritmo hacia Gemini: llamadas por minuto (0 = sin limite), simultaneas (0 = sin limite) y espera maxima en cola (ms). */
    maxRequestsPerMinute: number;
    maxConcurrent: number;
    queueMaxWaitMs: number;
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
    let value = (raw ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
    if (value.length >= 2 && /^["'`]/.test(value) && value.endsWith(value[0] ?? '')) value = value.slice(1, -1).trim();
    return value;
  };
  const candidates = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;
  for (const name of candidates) {
    const key = clean(env[name]);
    if (key === '') continue;
    let warning: string | null = null;
    if (/\s/.test(key)) warning = `${name} contiene espacios o saltos de linea: probablemente se copio mal`;
    else if (/^(tu_|your_|xxx|changeme|<)/i.test(key)) warning = `${name} parece un valor de ejemplo y no una clave real`;
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
      this.errors.push(`${key} debe ser un entero entre ${min} y ${max}`);
      return fallback;
    }
    return value;
  }

  float(key: string, fallback: number, min: number, max: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      this.errors.push(`${key} debe ser un numero entre ${min} y ${max}`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return fallback;
    if (['true', '1', 'yes', 'si'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    this.errors.push(`${key} debe ser true o false`);
    return fallback;
  }

  required(key: string): string {
    const value = this.str(key);
    if (value === '') this.errors.push(`${key} es obligatorio cuando ODOO_MODE=live`);
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
      errors.push(`ODOO_CATEGORY_MAP: clave desconocida "${key}"`);
    } else if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`ODOO_CATEGORY_MAP: valor invalido para "${key}"`);
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
      url: r.required('ODOO_URL').replace(/\/+$/, ''),
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
    messaging: {
      debounceMs: r.int('MESSAGE_DEBOUNCE_MS', 2500, 0, 15000),
      debounceMaxWaitMs: r.int('MESSAGE_DEBOUNCE_MAX_WAIT_MS', 8000, 1000, 60000),
      userRate: {
        enabled: r.bool('RATE_LIMIT_ENABLED', true),
        max: r.int('WEBHOOK_USER_RATE_MAX', 10, 1, 1000),
        windowSeconds: r.int('WEBHOOK_USER_RATE_WINDOW_SECONDS', 60, 1, 3600),
      },
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
      quotaMaxWaitMs: r.int('GEMINI_QUOTA_MAX_WAIT_MS', 20000, 0, 120000),
      maxRequestsPerMinute: r.int('GEMINI_MAX_RPM', 0, 0, 100000),
      maxConcurrent: r.int('GEMINI_MAX_CONCURRENT', 4, 0, 64),
      queueMaxWaitMs: r.int('GEMINI_QUEUE_MAX_WAIT_MS', 30000, 1000, 300000),
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
