import type { HttpFn } from './http';
import { httpRequest } from './http';
import { arr, rec, str } from './payload';
import type { IChannelAdapter, InboundMessage } from './types';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { chunkText } from '../utils/text';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  graphVersion: string;
}

const MAX_CHARS = 3800;

/** Extrae los mensajes entrantes del payload de WhatsApp Cloud API. */
export function parseWhatsAppPayload(body: unknown): InboundMessage[] {
  const messages: InboundMessage[] = [];
  for (const entry of arr(rec(body).entry)) {
    for (const change of arr(rec(entry).changes)) {
      const value = rec(rec(change).value);
      for (const raw of arr(value.messages)) {
        const message = rec(raw);
        const from = str(message.from);
        if (from === '') continue;
        const isText = str(message.type) === 'text';
        const profile = rec(rec(arr(value.contacts)[0]).profile);
        const timestamp = Number(str(message.timestamp));
        messages.push({
          channel: 'whatsapp',
          externalUserId: from,
          text: isText ? str(rec(message.text).body) : '',
          kind: isText ? 'text' : 'unsupported',
          messageId: str(message.id) || null,
          metadata: str(profile.name) !== '' ? { contactName: str(profile.name) } : {},
          receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return messages;
}

export class WhatsAppAdapter implements IChannelAdapter {
  readonly channel = 'whatsapp' as const;

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly log: Logger,
    private readonly http: HttpFn = httpRequest,
  ) {}

  get verifyToken(): string {
    return this.config.verifyToken;
  }

  isConfigured(): boolean {
    return this.config.accessToken !== '' && this.config.phoneNumberId !== '';
  }

  async receive(body: unknown): Promise<InboundMessage[]> {
    return parseWhatsAppPayload(body);
  }

  async sendText(message: InboundMessage, text: string): Promise<void> {
    if (!this.isConfigured()) {
      this.log.warn('WhatsApp sin credenciales: respuesta no enviada');
      return;
    }
    const url = `https://graph.facebook.com/${this.config.graphVersion}/${this.config.phoneNumberId}/messages`;
    for (const part of chunkText(text, MAX_CHARS)) {
      const result = await this.http(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.externalUserId,
          type: 'text',
          text: { body: part, preview_url: false },
        }),
      });
      if (!result.ok) {
        throw new AppError('CHANNEL_ERROR', 'WhatsApp rechazo el envio del mensaje', 502, {
          status: result.status,
          response: result.json,
        });
      }
    }
  }
}
