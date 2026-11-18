/** Minusculas, sin acentos, solo [a-z0-9] separado por espacios. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized === '' ? [] : normalized.split(' ');
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0)).trimEnd()}…`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Divide un texto largo en trozos <= max, cortando por parrafos o espacios. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim() !== '') chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    let rest = paragraph;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(' ', max);
      const at = cut > max * 0.5 ? cut : max;
      flush();
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (current.length + rest.length + 2 > max) flush();
    current = current === '' ? rest : `${current}\n\n${rest}`;
  }
  flush();
  return chunks;
}
