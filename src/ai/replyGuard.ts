import type { Channel } from '../types/domain';
import { escapeRegExp } from '../utils/text';

export interface GuardOptions {
  /** Direccion exacta de la tienda (si esta configurada, jamas sale en Mercado Libre). */
  storeAddress?: string;
}

export interface GuardResult {
  text: string;
  /** true si se elimino contenido prohibido. */
  modified: boolean;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+\.(?:com|net|org|ve|io|me|app|co|info|shop|store|link)\b(?:\/\S*)?/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const HANDLE_RE = /(^|[\s(])@[\w.]{3,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
const ADDRESS_RE =
  /\b(?:av\.?|avenida|calle|carrera|c\.c\.?|centro comercial|urbanizaci[oó]n|zona industrial)\s+[\wÁÉÍÓÚáéíóúñÑ.#-]+(?:\s+[\wÁÉÍÓÚáéíóúñÑ.#-]+){0,4}/gi;
const CONTACT_PHRASE_RE = /\b(?:escr[ií]benos|cont[aá]ctanos|escr[ií]beme|ll[aá]manos)\s+(?:al|por|a)\s+(?:whatsapp|instagram|ig|wa|tel[eé]fono)\b/gi;

function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/** Elimina contacto externo, enlaces y direcciones (regla critica de Mercado Libre). */
export function sanitizeForMercadoLibre(input: string, options: GuardOptions = {}): GuardResult {
  let text = input;

  if (options.storeAddress && options.storeAddress.trim() !== '') {
    text = text.replace(new RegExp(escapeRegExp(options.storeAddress.trim()), 'gi'), '');
  }
  text = text
    .replace(URL_RE, '')
    .replace(EMAIL_RE, '')
    .replace(BARE_DOMAIN_RE, '')
    .replace(HANDLE_RE, '$1')
    .replace(PHONE_RE, (match) => (digitCount(match) >= 9 ? '' : match))
    .replace(ADDRESS_RE, '')
    .replace(CONTACT_PHRASE_RE, '');

  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, modified: text !== input.trim() };
}

/** Markdown de LLM -> formato nativo del canal. */
function adaptFormatting(channel: Channel, input: string): string {
  const withoutHeadings = input.replace(/^#{1,6}\s*/gm, '');
  if (channel === 'whatsapp' || channel === 'web') {
    // **negrita** (markdown) -> *negrita* (WhatsApp)
    return withoutHeadings.replace(/\*\*(.+?)\*\*/g, '*$1*');
  }
  // Instagram y Mercado Libre no renderizan formato: texto plano.
  return withoutHeadings.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S[^*\n]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2');
}

/** Ultima barrera antes de enviar: formato del canal + politicas de seguridad. */
export function enforceChannelOutput(channel: Channel, text: string, options: GuardOptions = {}): GuardResult {
  const formatted = adaptFormatting(channel, text).trim();
  if (channel === 'mercadolibre') return sanitizeForMercadoLibre(formatted, options);
  return { text: formatted, modified: formatted !== text.trim() };
}
