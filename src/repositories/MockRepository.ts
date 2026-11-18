import fs from 'node:fs';
import path from 'node:path';
import type { IInventoryRepository, RepositoryHealth } from './IInventoryRepository';
import { MAX_REPO_RESULTS } from './IInventoryRepository';
import { filterProducts, matchesAllTokens, sortByRelevance } from './matching';
import type {
  LeadInput,
  LeadRecord,
  Product,
  ProductSearchQuery,
  ProductSpecs,
  ServiceItem,
  ServiceKind,
} from '../types/domain';
import { isProductCategory } from '../types/domain';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { tokenize } from '../utils/text';
import { isRecord } from '../utils/validators';

export interface MockRepositoryOptions {
  catalogPath: string;
  leadsPath: string;
}

export interface ParsedCatalog {
  products: Product[];
  services: ServiceItem[];
}

const SERVICE_KINDS: readonly ServiceKind[] = ['assembly', 'cable_management', 'os_setup', 'other'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Valida y normaliza el JSON del catalogo. Lanza CONFIG_ERROR con la lista de problemas. */
export function parseCatalog(raw: unknown): ParsedCatalog {
  const problems: string[] = [];
  const products: Product[] = [];
  const services: ServiceItem[] = [];
  const seen = new Set<string>();

  if (!isRecord(raw)) {
    throw new AppError('CONFIG_ERROR', 'El catalogo mock debe ser un objeto JSON', 500);
  }

  const rawProducts = Array.isArray(raw.products) ? raw.products : [];
  rawProducts.forEach((entry: unknown, index: number) => {
    const label = `products[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label}: debe ser un objeto`);
      return;
    }
    const { sku, name, brand, category, price_usd: price, stock, specs, tags, summary } = entry;
    if (typeof sku !== 'string' || sku === '') return void problems.push(`${label}: sku invalido`);
    if (seen.has(sku)) return void problems.push(`${label}: sku duplicado "${sku}"`);
    if (typeof name !== 'string' || name === '') return void problems.push(`${label}: name invalido`);
    if (!isProductCategory(category)) return void problems.push(`${label}: category invalida`);
    if (typeof price !== 'number' || !(price >= 0)) return void problems.push(`${label}: price_usd invalido`);
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      return void problems.push(`${label}: stock invalido`);
    }
    seen.add(sku);
    products.push({
      id: sku,
      sku,
      name,
      brand: typeof brand === 'string' ? brand : '',
      category,
      priceUsd: price,
      stock,
      specs: isRecord(specs) ? (specs as ProductSpecs) : {},
      tags: isStringArray(tags) ? tags : [],
      summary: typeof summary === 'string' ? summary : '',
    });
  });

  const rawServices = Array.isArray(raw.services) ? raw.services : [];
  rawServices.forEach((entry: unknown, index: number) => {
    const label = `services[${index}]`;
    if (!isRecord(entry)) return void problems.push(`${label}: debe ser un objeto`);
    const { sku, name, kind, price_usd: price, description } = entry;
    if (typeof sku !== 'string' || sku === '') return void problems.push(`${label}: sku invalido`);
    if (typeof name !== 'string' || name === '') return void problems.push(`${label}: name invalido`);
    if (typeof price !== 'number' || !(price >= 0)) return void problems.push(`${label}: price_usd invalido`);
    const serviceKind = SERVICE_KINDS.find((k) => k === kind) ?? 'other';
    services.push({
      id: sku,
      sku,
      name,
      kind: serviceKind,
      priceUsd: price,
      description: typeof description === 'string' ? description : '',
    });
  });

  if (problems.length > 0) {
    throw new AppError('CONFIG_ERROR', 'El catalogo mock contiene errores', 500, problems);
  }
  return { products, services };
}

/** Repositorio de demostracion: catalogo JSON local + leads en archivo. Sin credenciales. */
export class MockRepository implements IInventoryRepository {
  readonly mode = 'mock' as const;
  private readonly products: Product[];
  private readonly services: ServiceItem[];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: MockRepositoryOptions,
    private readonly log: Logger,
  ) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(options.catalogPath, 'utf8')) as unknown;
    } catch (error) {
      throw new AppError('CONFIG_ERROR', `No se pudo leer el catalogo mock en ${options.catalogPath}`, 500, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const parsed = parseCatalog(raw);
    this.products = parsed.products;
    this.services = parsed.services;
    this.log.info('Catalogo mock cargado', { productos: this.products.length, servicios: this.services.length });
  }

  async healthCheck(): Promise<RepositoryHealth> {
    return {
      ok: true,
      mode: 'mock',
      detail: `${this.products.length} productos y ${this.services.length} servicios en memoria`,
    };
  }

  async searchProducts(query: ProductSearchQuery): Promise<Product[]> {
    return filterProducts(this.products, query).map(cloneProduct);
  }

  async lookupByName(text: string): Promise<Product[]> {
    const tokens = tokenize(text);
    if (tokens.length === 0) return [];
    const matched = this.products.filter((p) => matchesAllTokens(p, tokens));
    return sortByRelevance(matched, tokens).slice(0, MAX_REPO_RESULTS).map(cloneProduct);
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const found = this.products.find((p) => p.sku.toLowerCase() === sku.trim().toLowerCase());
    return found ? cloneProduct(found) : null;
  }

  async listServices(): Promise<ServiceItem[]> {
    return this.services.slice(0, MAX_REPO_RESULTS).map((s) => ({ ...s }));
  }

  async createLead(input: LeadInput): Promise<LeadRecord> {
    const createdAt = new Date().toISOString();
    const id = `LEAD-${createdAt.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const record = { id, createdAt, ...input };

    const task = this.writeQueue.then(() => this.appendLead(record));
    this.writeQueue = task.catch(() => undefined);
    try {
      await task;
    } catch (error) {
      throw new AppError('REPOSITORY_ERROR', 'No se pudo guardar el lead en el archivo local', 500, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    this.log.info('Lead guardado (mock)', { leadId: id, canal: input.channel });
    return { id, mode: 'mock', createdAt, quotationId: null };
  }

  private async appendLead(record: object): Promise<void> {
    const file = path.resolve(this.options.leadsPath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    let existing: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }
    existing.push(record);
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(existing, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
  }
}

function cloneProduct(product: Product): Product {
  return { ...product, specs: { ...product.specs }, tags: [...product.tags] };
}
