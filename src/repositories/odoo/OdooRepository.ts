import type { OdooCategoryKey } from '../../config/env';
import type { IInventoryRepository, RepositoryHealth } from '../IInventoryRepository';
import { clampLimit, sortByRelevance } from '../matching';
import type {
  LeadInput,
  LeadRecord,
  Product,
  ProductCategory,
  ProductSearchQuery,
  QuoteSnapshot,
  ServiceItem,
  ServiceKind,
} from '../../types/domain';
import { AppError } from '../../utils/errors';
import type { Logger } from '../../utils/logger';
import { escapeHtml, normalizeText, round2, tokenize } from '../../utils/text';
import type { OdooClient } from './OdooClient';
import { buildOr, parseSpecText, specFilterToDomain } from './specs';
import type { XmlRpcStruct, XmlRpcValue } from './xmlrpc';

export interface OdooRepositoryOptions {
  categoryMap: Record<OdooCategoryKey, string>;
  /** Campo de product.template con las especificaciones (por defecto description_sale). */
  specsField: string;
  /** Crear tambien una cotizacion borrador (sale.order) ademas del crm.lead. */
  createQuotation: boolean;
}

const BASE_FIELDS = ['id', 'name', 'default_code', 'list_price', 'qty_available', 'categ_id'];

function asStruct(value: XmlRpcValue): XmlRpcStruct | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function asStructs(value: XmlRpcValue): XmlRpcStruct[] {
  if (!Array.isArray(value)) return [];
  return value.map(asStruct).filter((s): s is XmlRpcStruct => s !== null);
}

/** Odoo devuelve `false` para campos vacios. */
function text(value: XmlRpcValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: XmlRpcValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Un many2one llega como [id, "nombre"]. */
function many2oneName(value: XmlRpcValue | undefined): string {
  return Array.isArray(value) && typeof value[1] === 'string' ? value[1] : '';
}

function many2oneId(value: XmlRpcValue | undefined): number | null {
  return Array.isArray(value) && typeof value[0] === 'number' ? value[0] : null;
}

function classifyService(name: string): ServiceKind {
  const n = normalizeText(name);
  if (/ensambl|montaje/.test(n)) return 'assembly';
  if (/cable/.test(n)) return 'cable_management';
  if (/windows|sistema operativo|driver|instalacion|configuracion/.test(n)) return 'os_setup';
  return 'other';
}

function isoDate(value: string | undefined): string | null {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

function describeLead(input: LeadInput): string {
  const lines = [
    `Canal: ${input.channel}${input.externalUserId ? ` (${input.externalUserId})` : ''}`,
    `Cliente: ${input.customerName} - Tel: ${input.phone}`,
  ];
  if (input.preferredVisit) lines.push(`Visita preferida: ${input.preferredVisit}`);
  if (input.notes) lines.push(`Notas: ${input.notes}`);
  if (input.quote) {
    const q = input.quote;
    lines.push('', `Cotizacion de PC (${q.purpose ?? 'sin proposito'}) - presupuesto ${q.budgetUsd ?? 'n/d'} USD`);
    for (const line of [...q.items, ...q.services]) lines.push(`- ${line.name} [${line.sku}]: ${line.priceUsd} USD`);
    lines.push(`Subtotal: ${q.subtotalUsd} USD | Servicios: ${q.servicesUsd} USD | TOTAL: ${q.totalUsd} USD`);
    lines.push(`Entrega estimada: ${q.deliveryEta}`);
  }
  return lines.join('\n');
}

/** Implementacion de produccion sobre Odoo Community (XML-RPC). Solo acceso a datos. */
export class OdooRepository implements IInventoryRepository {
  readonly mode = 'live' as const;

  constructor(
    private readonly client: OdooClient,
    private readonly options: OdooRepositoryOptions,
    private readonly log: Logger,
  ) {}

  async healthCheck(): Promise<RepositoryHealth> {
    try {
      const version = await this.client.version();
      await this.client.authenticate();
      return { ok: true, mode: 'live', detail: `Odoo ${text(version.server_version) || 'conectado'}` };
    } catch (error) {
      return { ok: false, mode: 'live', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchProducts(query: ProductSearchQuery): Promise<Product[]> {
    const specsField = this.options.specsField;
    // Regla fija: solo vendibles con stock disponible.
    const domain: XmlRpcValue[] = [
      ['sale_ok', '=', true],
      ['qty_available', '>', 0],
    ];

    if (query.category !== undefined) {
      domain.push(['categ_id', 'child_of', this.options.categoryMap[query.category]]);
    }
    if (query.minPriceUsd !== undefined) domain.push(['list_price', '>=', query.minPriceUsd]);
    if (query.maxPriceUsd !== undefined) domain.push(['list_price', '<=', query.maxPriceUsd]);

    const textTokens = tokenize(query.text ?? '');
    for (const token of textTokens) {
      domain.push(...buildOr([['name', 'ilike', token], ['default_code', 'ilike', token]]));
    }

    const keywords = (query.keywords ?? []).flatMap((k) => tokenize(k));
    if (keywords.length > 0) {
      domain.push(...buildOr(keywords.flatMap((k) => [['name', 'ilike', k], [specsField, 'ilike', k]])));
    }
    domain.push(...specFilterToDomain(query.spec, specsField));

    const order = query.sort === 'price_desc' ? 'list_price desc' : 'list_price asc';
    const records = await this.searchRead('product.template', domain, {
      fields: this.fields(),
      limit: clampLimit(query.limit),
      order,
    });

    const products = records
      .map((record) => this.toProduct(record, query.category))
      .filter((p): p is Product => p !== null);
    return textTokens.length > 0 && query.sort === undefined ? sortByRelevance(products, textTokens) : products;
  }

  async lookupByName(textQuery: string): Promise<Product[]> {
    const tokens = tokenize(textQuery);
    if (tokens.length === 0) return [];

    const domain: XmlRpcValue[] = [['sale_ok', '=', true]];
    for (const token of tokens) {
      domain.push(...buildOr([['name', 'ilike', token], ['default_code', 'ilike', token]]));
    }
    const records = await this.searchRead('product.template', domain, {
      fields: this.fields(),
      limit: clampLimit(undefined),
      order: 'list_price asc',
    });
    const products = records.map((r) => this.toProduct(r)).filter((p): p is Product => p !== null);
    return sortByRelevance(products, tokens);
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const odooId = /^ODOO-(\d+)$/.exec(sku.trim());
    const domain: XmlRpcValue[] = [
      ['sale_ok', '=', true],
      odooId ? ['id', '=', Number(odooId[1])] : ['default_code', '=', sku.trim()],
    ];
    const records = await this.searchRead('product.template', domain, { fields: this.fields(), limit: 1 });
    const first = records[0];
    return first === undefined ? null : this.toProduct(first);
  }

  async listServices(): Promise<ServiceItem[]> {
    const domain: XmlRpcValue[] = [
      ['sale_ok', '=', true],
      ['categ_id', 'child_of', this.options.categoryMap.service],
    ];
    const records = await this.searchRead('product.template', domain, {
      fields: this.fields(),
      limit: clampLimit(undefined),
      order: 'id asc',
    });
    return records.flatMap((record): ServiceItem[] => {
      const id = numberOf(record.id);
      const name = text(record.name);
      if (id === 0 || name === '') return [];
      return [
        {
          id: String(id),
          sku: text(record.default_code) || `ODOO-${id}`,
          name,
          kind: classifyService(name),
          priceUsd: round2(numberOf(record.list_price)),
          description: parseSpecText(text(record[this.options.specsField])).summary,
        },
      ];
    });
  }

  async createLead(input: LeadInput): Promise<LeadRecord> {
    const description = describeLead(input);
    const values: XmlRpcStruct = {
      name: `[Bot ${input.channel}] ${input.customerName} - Visita en tienda`,
      contact_name: input.customerName,
      phone: input.phone,
      type: 'opportunity',
      description: `<p>${escapeHtml(description).replace(/\n/g, '<br/>')}</p>`,
      expected_revenue: input.quote?.totalUsd ?? 0,
    };
    const deadline = isoDate(input.preferredVisit);
    if (deadline !== null) values.date_deadline = deadline;

    const created = await this.client.executeKw('crm.lead', 'create', [values]);
    if (typeof created !== 'number') {
      throw new AppError('ODOO_RPC_ERROR', 'Odoo no devolvio el id del lead creado', 502);
    }

    let quotationId: string | null = null;
    if (this.options.createQuotation && input.quote) {
      try {
        quotationId = await this.createQuotation(input, input.quote);
      } catch (error) {
        // El lead ya existe: una falla en la cotizacion borrador no debe perderlo.
        this.log.warn('No se pudo crear la cotizacion borrador', {
          leadId: created,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.log.info('Lead creado en Odoo', { leadId: created, quotationId });
    return { id: String(created), mode: 'live', createdAt: new Date().toISOString(), quotationId };
  }

  // ---------------------------------------------------------------- privado

  private fields(): string[] {
    return [...BASE_FIELDS, this.options.specsField];
  }

  private async searchRead(
    model: string,
    domain: XmlRpcValue[],
    kwargs: { fields: string[]; limit: number; order?: string },
  ): Promise<XmlRpcStruct[]> {
    const params: XmlRpcStruct = { fields: kwargs.fields, limit: kwargs.limit };
    if (kwargs.order !== undefined) params.order = kwargs.order;
    return asStructs(await this.client.executeKw(model, 'search_read', [domain], params));
  }

  private inferCategory(odooCategoryName: string): ProductCategory | null {
    const normalized = normalizeText(odooCategoryName);
    for (const [key, name] of Object.entries(this.options.categoryMap)) {
      if (key !== 'service' && normalized.includes(normalizeText(name))) return key as ProductCategory;
    }
    return null;
  }

  private toProduct(record: XmlRpcStruct, categoryHint?: ProductCategory): Product | null {
    const id = numberOf(record.id);
    const name = text(record.name);
    const category = categoryHint ?? this.inferCategory(many2oneName(record.categ_id));
    if (id === 0 || name === '' || category === null) return null;

    const parsed = parseSpecText(text(record[this.options.specsField]));
    const declaredBrand = parsed.specs.brand;
    return {
      id: String(id),
      sku: text(record.default_code) || `ODOO-${id}`,
      name,
      brand: typeof declaredBrand === 'string' ? declaredBrand : (name.split(' ')[0] ?? ''),
      category,
      priceUsd: round2(numberOf(record.list_price)),
      stock: Math.max(0, Math.floor(numberOf(record.qty_available))),
      specs: parsed.specs,
      tags: parsed.tags,
      summary: parsed.summary,
    };
  }

  /** Cotizacion borrador (sale.order) con partner buscado/creado por telefono. */
  private async createQuotation(input: LeadInput, quote: QuoteSnapshot): Promise<string | null> {
    const lines = [...quote.items, ...quote.services];
    const templateIds = lines.map((l) => Number(l.productId)).filter((n) => Number.isInteger(n) && n > 0);
    if (templateIds.length === 0) return null;

    const templates = asStructs(
      await this.client.executeKw('product.template', 'read', [templateIds], { fields: ['product_variant_id'] }),
    );
    const variantByTemplate = new Map<number, number>();
    for (const t of templates) {
      const variantId = many2oneId(t.product_variant_id);
      if (variantId !== null) variantByTemplate.set(numberOf(t.id), variantId);
    }

    const orderLines: XmlRpcValue[] = lines.flatMap((line): XmlRpcValue[] => {
      const variantId = variantByTemplate.get(Number(line.productId));
      return variantId === undefined
        ? []
        : [[0, 0, { product_id: variantId, name: line.name, product_uom_qty: 1, price_unit: line.priceUsd }]];
    });
    if (orderLines.length === 0) return null;

    const partners = asStructs(
      await this.client.executeKw('res.partner', 'search_read', [[['phone', '=', input.phone]]], {
        fields: ['id'],
        limit: 1,
      }),
    );
    const existing = partners[0];
    const partnerId =
      existing !== undefined
        ? numberOf(existing.id)
        : await this.client.executeKw('res.partner', 'create', [{ name: input.customerName, phone: input.phone }]);
    if (typeof partnerId !== 'number' || partnerId === 0) return null;

    const orderId = await this.client.executeKw('sale.order', 'create', [
      {
        partner_id: partnerId,
        origin: `Bot TECS (${input.channel})`,
        note: `Cotizacion generada por el asistente. Entrega estimada: ${quote.deliveryEta}`,
        order_line: orderLines,
      },
    ]);
    return typeof orderId === 'number' ? String(orderId) : null;
  }
}
