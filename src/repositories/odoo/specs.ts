import type { ProductSpecs, SpecFilter } from '../../types/domain';
import type { XmlRpcValue } from './xmlrpc';

/**
 * Convencion de especificaciones en Odoo: lineas "clave: valor" dentro del campo
 * de especificaciones del producto (por defecto description_sale).
 *
 *   socket: AM4
 *   memory_type: DDR4
 *   form_factors: |ATX|mATX|ITX|
 *   tdp_w: 65
 *   igpu: si
 *   tags: gaming, economico
 *   summary: Texto corto para el cliente
 */
const NUMERIC_KEYS = new Set([
  'cores',
  'threads',
  'tdp_w',
  'capacity_gb',
  'speed_mhz',
  'vram_gb',
  'gpu_length_mm',
  'max_gpu_length_mm',
  'recommended_psu_w',
  'wattage_w',
  'screen_in',
  'ram_gb',
]);
const BOOLEAN_KEYS = new Set(['igpu']);
const LIST_KEYS = new Set(['form_factors']);

export interface ParsedSpecText {
  specs: ProductSpecs;
  tags: string[];
  summary: string;
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function parseSpecText(text: string): ParsedSpecText {
  const specs: ProductSpecs = {};
  let tags: string[] = [];
  let summary = '';

  for (const line of stripHtml(text).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase().replace(/\s+/g, '_');
    const value = line.slice(separator + 1).trim();
    if (key === '' || value === '') continue;

    if (key === 'tags') {
      tags = value.split(',').map((t) => t.trim()).filter((t) => t !== '');
    } else if (key === 'summary' || key === 'resumen') {
      summary = value;
    } else if (NUMERIC_KEYS.has(key)) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) specs[key] = parsed;
    } else if (BOOLEAN_KEYS.has(key)) {
      specs[key] = ['si', 'sí', 'yes', 'true', '1'].includes(value.toLowerCase());
    } else if (LIST_KEYS.has(key)) {
      specs[key] = value.split('|').map((v) => v.trim()).filter((v) => v !== '');
    } else {
      specs[key] = value;
    }
  }
  return { specs, tags, summary };
}

/** Inversa de parseSpecText: genera el texto para pegar en Odoo (util para migrar el catalogo mock). */
export function formatSpecText(specs: ProductSpecs, tags: string[], summary: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(specs)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) lines.push(`${key}: |${value.join('|')}|`);
    else if (typeof value === 'boolean') lines.push(`${key}: ${value ? 'si' : 'no'}`);
    else lines.push(`${key}: ${value}`);
  }
  if (tags.length > 0) lines.push(`tags: ${tags.join(', ')}`);
  if (summary !== '') lines.push(`summary: ${summary}`);
  return lines.join('\n');
}

/** Une terminos de dominio Odoo (notacion polaca) con OR: n terminos -> n-1 operadores '|'. */
export function buildOr(terms: XmlRpcValue[]): XmlRpcValue[] {
  if (terms.length === 0) return [];
  return [...Array<XmlRpcValue>(terms.length - 1).fill('|'), ...terms];
}

/** Traduce filtros tecnicos a clausulas ilike sobre el campo de especificaciones. */
export function specFilterToDomain(filter: SpecFilter | undefined, specsField: string): XmlRpcValue[] {
  if (filter === undefined) return [];
  const domain: XmlRpcValue[] = [];
  if (filter.socket) domain.push([specsField, 'ilike', `socket: ${filter.socket}`]);
  if (filter.memoryType) domain.push([specsField, 'ilike', `memory_type: ${filter.memoryType}`]);
  if (filter.formFactor) domain.push([specsField, 'ilike', `form_factor: ${filter.formFactor}`]);
  if (filter.supportsFormFactor) domain.push([specsField, 'ilike', `|${filter.supportsFormFactor}|`]);
  return domain;
}
