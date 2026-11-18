import { MAX_REPO_RESULTS } from './IInventoryRepository';
import type { Product, ProductSearchQuery, SpecFilter } from '../types/domain';
import { normalizeText, tokenize } from '../utils/text';

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_REPO_RESULTS;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_REPO_RESULTS);
}

function equalsIgnoreCase(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

export function specMatches(specs: Product['specs'], filter: SpecFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.socket && !equalsIgnoreCase(specs.socket, filter.socket)) return false;
  if (filter.memoryType && !equalsIgnoreCase(specs.memory_type, filter.memoryType)) return false;
  if (filter.formFactor && !equalsIgnoreCase(specs.form_factor, filter.formFactor)) return false;
  if (filter.supportsFormFactor) {
    const wanted = filter.supportsFormFactor;
    if (!(specs.form_factors ?? []).some((f) => equalsIgnoreCase(f, wanted))) return false;
  }
  return true;
}

type Matchable = Pick<Product, 'name' | 'brand' | 'sku'>;

/** Todas las palabras deben aparecer en nombre + marca + SKU. */
export function matchesAllTokens(product: Matchable, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalizeText(`${product.name} ${product.brand} ${product.sku}`);
  return tokens.every((token) => haystack.includes(token));
}

/** Basta con que coincida alguna palabra de preferencia en nombre, etiquetas, resumen o specs. */
export function matchesAnyKeyword(product: Product, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const specText = Object.values(product.specs)
    .map((value) => (Array.isArray(value) ? value.join(' ') : String(value ?? '')))
    .join(' ');
  const haystack = normalizeText(
    `${product.name} ${product.brand} ${product.tags.join(' ')} ${product.summary} ${specText}`,
  );
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** Relevancia de un producto frente a las palabras buscadas (mayor = mejor). */
export function relevanceScore(product: Matchable, tokens: string[]): number {
  const nameTokens = tokenize(product.name);
  let score = 0;
  for (const token of tokens) {
    if (nameTokens.includes(token)) score += 3;
    else if (nameTokens.some((n) => n.startsWith(token))) score += 1;
  }
  if (tokens.length > 0 && normalizeText(product.name).includes(tokens.join(' '))) score += 2;
  return score - nameTokens.length * 0.01;
}

export function sortByRelevance<T extends Matchable>(items: T[], tokens: string[]): T[] {
  return [...items].sort((a, b) => relevanceScore(b, tokens) - relevanceScore(a, tokens));
}

export function sortByPrice<T extends { priceUsd: number }>(items: T[], direction: 'price_asc' | 'price_desc'): T[] {
  return [...items].sort((a, b) => (direction === 'price_asc' ? a.priceUsd - b.priceUsd : b.priceUsd - a.priceUsd));
}

/** Aplica la consulta completa sobre una lista en memoria (usado por MockRepository y en pruebas). */
export function filterProducts(products: Product[], query: ProductSearchQuery): Product[] {
  const textTokens = tokenize(query.text ?? '');
  const keywords = (query.keywords ?? []).flatMap((k) => tokenize(k));

  const matched = products.filter(
    (p) =>
      p.stock > 0 &&
      (query.category === undefined || p.category === query.category) &&
      (query.minPriceUsd === undefined || p.priceUsd >= query.minPriceUsd) &&
      (query.maxPriceUsd === undefined || p.priceUsd <= query.maxPriceUsd) &&
      specMatches(p.specs, query.spec) &&
      matchesAllTokens(p, textTokens) &&
      matchesAnyKeyword(p, keywords),
  );

  const ordered =
    query.sort !== undefined
      ? sortByPrice(matched, query.sort)
      : textTokens.length > 0
        ? sortByRelevance(matched, textTokens)
        : sortByPrice(matched, 'price_asc');

  return ordered.slice(0, clampLimit(query.limit));
}
