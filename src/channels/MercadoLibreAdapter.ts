import type { HttpFn, HttpResult } from './http';
import { httpRequest } from './http';
import { rec, str } from './payload';
import type { IChannelAdapter, InboundMessage } from './types';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { truncate } from '../utils/text';

export interface MercadoLibreConfig {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  /** Id del usuario vendedor: valida las notificaciones e ignora preguntas propias. */
  sellerId: string;
  apiBase?: string;
}

const DEFAULT_API = 'https://api.mercadolibre.com';
/** Limite de ML para el texto de una respuesta. */
const MAX_ANSWER_CHARS = 2000;

/**
 * Mercado Libre notifica "questions" con un recurso (/questions/{id}); hay que consultar la
 * pregunta y responderla via POST /answers. Las respuestas son PUBLICAS: el filtro de contenido
 * prohibido se aplica antes (replyGuard) y en el prompt del canal.
 */
export class MercadoLibreAdapter implements IChannelAdapter {
  readonly channel = 'mercadolibre' as const;
  private accessToken: string;
  private refreshToken: string;
  private readonly apiBase: string;

  constructor(
    private readonly config: MercadoLibreConfig,
    private readonly log: Logger,
    private readonly http: HttpFn = httpRequest,
  ) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.apiBase = config.apiBase ?? DEFAULT_API;
  }

  isConfigured(): boolean {
    return this.accessToken !== '';
  }

  /** Valida que la notificacion sea para nuestro vendedor. */
  isForSeller(body: unknown): boolean {
    const userId = str(rec(body).user_id);
    return this.config.sellerId === '' || userId === this.config.sellerId;
  }

  async receive(body: unknown): Promise<InboundMessage[]> {
    const notification = rec(body);
    const resource = str(notification.resource);
    if (str(notification.topic) !== 'questions' || !/^\/questions\/\d+$/.test(resource)) return [];
    if (!this.isForSeller(body)) {
      this.log.warn('Notificacion de Mercado Libre para otro vendedor: ignorada');
      return [];
    }
    if (!this.isConfigured()) {
      this.log.warn('Mercado Libre sin token de acceso: no se puede leer la pregunta');
      return [];
    }

    const result = await this.api('GET', resource);
    if (!result.ok) {
      throw new AppError('CHANNEL_ERROR', 'No se pudo leer la pregunta de Mercado Libre', 502, {
        status: result.status,
      });
    }
    const question = rec(result.json);
    const buyerId = str(rec(question.from).id);
    const questionId = str(question.id);
    const text = str(question.text);
    if (str(question.status) !== 'UNANSWERED' || buyerId === '' || questionId === '' || text === '') return [];
    if (buyerId === this.config.sellerId) return [];

    const itemId = str(question.item_id);
    const context = await this.itemContext(itemId);
    return [
      {
        channel: 'mercadolibre',
        externalUserId: itemId !== '' ? `${buyerId}:${itemId}` : buyerId,
        text: context !== '' ? `${context} Pregunta del comprador: ${text}` : text,
        kind: 'text',
        messageId: `ml-question-${questionId}`,
        metadata: { questionId, itemId },
        receivedAt: new Date().toISOString(),
      },
    ];
  }

  async sendText(message: InboundMessage, text: string): Promise<void> {
    const questionId = Number(message.metadata.questionId);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      throw new AppError('CHANNEL_ERROR', 'Falta el id de la pregunta de Mercado Libre', 500);
    }
    if (!this.isConfigured()) {
      this.log.warn('Mercado Libre sin token de acceso: respuesta no publicada');
      return;
    }
    const result = await this.api('POST', '/answers', {
      question_id: questionId,
      text: truncate(text, MAX_ANSWER_CHARS),
    });
    if (!result.ok) {
      throw new AppError('CHANNEL_ERROR', 'Mercado Libre rechazo la respuesta', 502, {
        status: result.status,
        response: result.json,
      });
    }
  }

  // ---------------------------------------------------------------- privado

  /** Titulo y precio de la publicacion, para que el modelo sepa de que producto hablan. */
  private async itemContext(itemId: string): Promise<string> {
    if (itemId === '') return '';
    try {
      const result = await this.api('GET', `/items/${encodeURIComponent(itemId)}`);
      if (!result.ok) return '';
      const item = rec(result.json);
      const title = str(item.title);
      if (title === '') return '';
      const price = str(item.price);
      const currency = str(item.currency_id);
      return `[Publicacion "${title}"${price !== '' ? `, precio publicado ${price} ${currency}` : ''}]`;
    } catch (error) {
      this.log.debug('No se pudo leer el contexto de la publicacion', { itemId, error });
      return '';
    }
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult> {
    const call = (): Promise<HttpResult> =>
      this.http(`${this.apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let result = await call();
    if (result.status === 401 && (await this.refreshAccessToken())) result = await call();
    return result;
  }

  /** Renueva el access token (dura ~6 horas). El nuevo refresh token solo vive en memoria. */
  private async refreshAccessToken(): Promise<boolean> {
    const { clientId, clientSecret } = this.config;
    if (this.refreshToken === '' || clientId === '' || clientSecret === '') return false;

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: this.refreshToken,
    });
    const result = await this.http(`${this.apiBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    const data = rec(result.json);
    if (!result.ok || str(data.access_token) === '') {
      this.log.error('No se pudo renovar el token de Mercado Libre', { status: result.status });
      return false;
    }
    this.accessToken = str(data.access_token);
    if (str(data.refresh_token) !== '') this.refreshToken = str(data.refresh_token);
    this.log.warn(
      'Token de Mercado Libre renovado en memoria: persiste el nuevo refresh token (TODO) o se perdera al reiniciar',
    );
    return true;
  }
}
