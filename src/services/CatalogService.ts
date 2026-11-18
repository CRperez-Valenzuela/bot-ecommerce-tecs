import type { IInventoryRepository } from '../repositories/IInventoryRepository';
import type { Product, ProductCategory, SpecFilter } from '../types/domain';
import { AppError } from '../utils/errors';
import { tokenize } from '../utils/text';
import { pickSpread } from './curation';

export interface SearchRequest {
  category: ProductCategory;
  maxPriceUsd?: number;
  preference?: string;
  text?: string;
}

export interface SearchOutcome {
  products: Product[];
  /** true si hubo que ignorar la preferencia porque no habia coincidencias. */
  preferenceIgnored: boolean;
}

export interface LookupOutcome {
  found: boolean;
  match: Product | null;
  available: boolean;
  /** Maximo 2, solo si el producto esta agotado. */
  alternatives: Product[];
  /** Otros modelos del mismo nombre que tambien estan en stock (maximo 2). */
  similar: Product[];
}

export const MAX_ALTERNATIVES = 2;

/** Preguntas cerradas de filtro por categoria (protocolo de desambiguacion). */
const CLARIFYING_QUESTIONS: Record<ProductCategory, string[]> = {
  case: ['¿Qué presupuesto aproximado tienes?', '¿Lo prefieres con estilo gamer (RGB), sobrio o compacto?'],
  laptop: ['¿Para qué la usarás: estudio/oficina, diseño o gaming?', '¿Cuál es tu presupuesto aproximado?'],
  cpu: ['¿Para qué lo usarás: gaming, edición o trabajo de oficina?', '¿Qué presupuesto aproximado tienes?'],
  motherboard: ['¿Para qué procesador la necesitas?', '¿Qué presupuesto aproximado tienes?'],
  ram: ['¿Cuántos GB buscas (16 o 32)?', '¿Qué presupuesto aproximado tienes?'],
  storage: ['¿Qué capacidad necesitas (500 GB, 1 TB)?', '¿Qué presupuesto aproximado tienes?'],
  gpu: ['¿Para qué la usarás: gaming o edición?', '¿Qué presupuesto aproximado tienes?'],
  psu: ['¿Qué tarjeta de video usarás (o qué potencia buscas)?', '¿Qué presupuesto aproximado tienes?'],
};

/** Consultas de catalogo con las reglas de curaduria comercial. */
export class CatalogService {
  constructor(private readonly repo: IInventoryRepository) {}

  /**
   * Busqueda curada. Si la consulta es vaga (sin texto, presupuesto ni preferencia)
   * NO consulta el repositorio: exige desambiguar primero.
   */
  async search(request: SearchRequest): Promise<SearchOutcome> {
    const hasNarrowing =
      request.maxPriceUsd !== undefined ||
      (request.preference !== undefined && request.preference !== '') ||
      (request.text !== undefined && request.text !== '');

    if (!hasNarrowing) {
      throw new AppError(
        'NEEDS_CLARIFICATION',
        'Consulta demasiado amplia: haz 1 o 2 preguntas cerradas al cliente antes de mostrar productos',
        422,
        { preguntas_sugeridas: CLARIFYING_QUESTIONS[request.category] },
      );
    }

    const keywords = tokenize(request.preference ?? '');
    const base = {
      category: request.category,
      text: request.text,
      maxPriceUsd: request.maxPriceUsd,
      sort: 'price_desc' as const,
    };

    let results = await this.repo.searchProducts({ ...base, keywords });
    let preferenceIgnored = false;
    if (results.length === 0 && keywords.length > 0) {
      results = await this.repo.searchProducts(base);
      preferenceIgnored = results.length > 0;
    }
    return { products: pickSpread(results), preferenceIgnored };
  }

  /** Consulta de un producto puntual: precio exacto, disponibilidad y alternativas si esta agotado. */
  async lookup(text: string): Promise<LookupOutcome> {
    const candidates = await this.repo.lookupByName(text);
    const match = candidates[0] ?? null;
    if (match === null) {
      return { found: false, match: null, available: false, alternatives: [], similar: [] };
    }

    const available = match.stock > 0;
    const similar = candidates
      .slice(1)
      .filter((p) => p.stock > 0 && p.category === match.category)
      .slice(0, MAX_ALTERNATIVES);
    const alternatives = available ? [] : await this.alternativesFor(match);
    return { found: true, match, available, alternatives, similar: available ? similar : [] };
  }

  /** Alternativas compatibles y del mismo rango de precio para un producto agotado. */
  async alternativesFor(product: Product): Promise<Product[]> {
    const spec: SpecFilter = {};
    if (product.category === 'cpu' || product.category === 'motherboard') {
      if (product.specs.socket) spec.socket = product.specs.socket;
    }
    if (product.category === 'ram' || product.category === 'motherboard') {
      if (product.specs.memory_type) spec.memoryType = product.specs.memory_type;
    }
    if (product.category === 'motherboard' && product.specs.form_factor) {
      spec.formFactor = product.specs.form_factor;
    }

    const results = await this.repo.searchProducts({
      category: product.category,
      maxPriceUsd: product.priceUsd * 1.35,
      spec,
      sort: 'price_desc',
    });
    return results
      .filter((p) => p.sku !== product.sku)
      .sort((a, b) => Math.abs(a.priceUsd - product.priceUsd) - Math.abs(b.priceUsd - product.priceUsd))
      .slice(0, MAX_ALTERNATIVES);
  }
}
