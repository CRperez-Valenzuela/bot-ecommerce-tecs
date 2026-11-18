import type { HttpFn } from './http';
import { httpRequest } from './http';
import { arr, rec, str } from './payload';
import type { IChannelAdapter, InboundMessage } from './types';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { chunkText } from '../utils/text';

export interface InstagramConfig {
  accessToken: string;
  verifyToken: string;
  graphVersion: string;
}

/** Instagram limita cada DM a ~1000 bytes: se parte con margen. */
const MAX_CHARS = 800;

/** Extrae los mensajes entrantes (messaging) del payload de Instagram DM. */
export function parseInstagramPayload(body: unknown): InboundMessage[] {
  const messages: InboundMessage[] = [];
  for (const entry of arr(rec(body).entry)) {
    for (const event of arr(rec(entry).messaging)) {
      const data = rec(event);
      const message = rec(data.message);
      const sender = str(rec(data.sender).id);
      if (sender === '' || Object.keys(message).length === 0) continue;
      if (message.is_echo === true) continue; // mensajes enviados por nosotros mismos

      const hasText = str(message.text) !== '';
      const timestamp = Number(str(data.timestamp));
      messages.push({
        channel: 'instagram',
        externalUserId: sender,
        text: str(message.text),
        kind: hasText ? 'text' : 'unsupported',
        messageId: str(message.mid) || null,
        metadata: {},
        receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString(),
      });
    }
  }
  return messages;
}

export class InstagramAdapter implements IChannelAdapter {
  readonly channel = 'instagram' as const;

  constructor(
    private readonly config: InstagramConfig,
    private readonly log: Logger,
    private readonly http: HttpFn = httpRequest,
  ) {}

  get verifyToken(): string {
    return this.config.verifyToken;
  }

  isConfigured(): boolean {
    return this.config.accessToken !== '';
  }

  async receive(body: unknown): Promise<InboundMessage[]> {
    return parseInstagramPayload(body);
  }

  async sendText(message: InboundMessage, text: string): Promise<void> {
    if (!this.isConfigured()) {
      this.log.warn('Instagram sin credenciales: respuesta no enviada');
      return;
    }
    const url = `https://graph.facebook.com/${this.config.graphVersion}/me/messages`;
    for (const part of chunkText(text, MAX_CHARS)) {
      const result = await this.http(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: message.externalUserId }, message: { text: part } }),
      });
      if (!result.ok) {
        throw new AppError('CHANNEL_ERROR', 'Instagram rechazo el envio del mensaje', 502, {
          status: result.status,
          response: result.json,
        });
      }
    }
  }
}
