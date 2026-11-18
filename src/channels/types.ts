import type { Channel } from '../types/domain';

export interface InboundMessage {
  channel: Channel;
  /** Identificador estable del usuario en el canal (define la sesion). */
  externalUserId: string;
  text: string;
  /** 'unsupported' = adjunto/audio/imagen: se responde con un aviso sin pasar por el LLM. */
  kind: 'text' | 'unsupported';
  /** Id del mensaje en la plataforma (para deduplicar reintentos de webhook). */
  messageId: string | null;
  /** Datos del canal necesarios para responder (ej. id de pregunta en Mercado Libre). */
  metadata: Record<string, string>;
  receivedAt: string;
}

/** Contrato desacoplado de cada canal de atencion. */
export interface IChannelAdapter {
  readonly channel: Channel;
  /** false si faltan credenciales: el webhook responde pero no puede contestar. */
  isConfigured(): boolean;
  /** Traduce el cuerpo del webhook a mensajes normalizados. */
  receive(body: unknown): Promise<InboundMessage[]>;
  /** Envia la respuesta al usuario (o la publica, en el caso de Mercado Libre). */
  sendText(message: InboundMessage, text: string): Promise<void>;
}
