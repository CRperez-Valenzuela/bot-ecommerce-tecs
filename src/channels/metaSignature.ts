import crypto from 'node:crypto';

export function computeMetaSignature(rawBody: Buffer, appSecret: string): string {
  return `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Valida el encabezado X-Hub-Signature-256 de los webhooks de Meta (WhatsApp / Instagram). */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (rawBody === undefined || header === undefined || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(computeMetaSignature(rawBody, appSecret), 'utf8');
  const received = Buffer.from(header, 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
