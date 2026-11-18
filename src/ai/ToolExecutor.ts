import type { IInventoryRepository } from '../repositories/IInventoryRepository';
import type { CatalogService } from '../services/CatalogService';
import type { PCBuildEngine } from '../services/PCBuildEngine';
import type { Session } from '../services/SessionStore';
import type { Channel, Product, QuoteSnapshot } from '../types/domain';
import { BUILD_CATEGORIES, PRODUCT_CATEGORIES } from '../types/domain';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import type { Args } from '../utils/validators';
import {
  optBoolean,
  optEnum,
  optNumber,
  optString,
  reqEnum,
  reqNumber,
  reqString,
} from '../utils/validators';
import { TOOL_NAMES } from './tools';

export interface StoreInfo {
  name: string;
  city: string;
  address: string;
  hours: string;
}

export interface ToolContext {
  session: Session;
  channel: Channel;
  /** Productos que aun se pueden mostrar en este mensaje (tope de curaduria). */
  displayBudget: { remaining: number };
}

export interface ToolExecutorDeps {
  catalog: CatalogService;
  engine: PCBuildEngine;
  repo: IInventoryRepository;
  store: StoreInfo;
  log: Logger;
}

type ToolHandler = (args: Args, ctx: ToolContext) => Promise<Record<string, unknown>>;

const PHONE_RE = /^\+?[\d\s().-]{7,25}$/;

export function productView(product: Product): Record<string, unknown> {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    priceUsd: product.priceUsd,
    stock: product.stock,
    specs: product.specs,
    summary: product.summary,
  };
}

/**
 * Aplica el tope de productos por mensaje EN CODIGO (no solo en el prompt):
 * aunque el modelo encadene varias busquedas, nunca se le entregan mas de 3 opciones.
 */
function allowDisplay<T>(ctx: ToolContext, items: T[]): T[] {
  if (items.length === 0) return items;
  const allowed = items.slice(0, Math.max(ctx.displayBudget.remaining, 0));
  if (allowed.length === 0) {
    throw new AppError(
      'DISPLAY_LIMIT_REACHED',
      'Ya mostraste el maximo de 3 opciones en este mensaje. No pidas mas productos: responde con lo que tienes.',
      409,
    );
  }
  ctx.displayBudget.remaining -= allowed.length;
  return allowed;
}

/** Ejecuta las funciones que Gemini solicita. Nunca lanza: devuelve siempre un resultado estructurado. */
export class ToolExecutor {
  private readonly handlers: Record<string, ToolHandler>;

  constructor(private readonly deps: ToolExecutorDeps) {
    this.handlers = {
      [TOOL_NAMES.searchProducts]: (args, ctx) => this.searchProducts(args, ctx),
      [TOOL_NAMES.lookupProduct]: (args, ctx) => this.lookupProduct(args, ctx),
      [TOOL_NAMES.startBuild]: (args, ctx) => this.startBuild(args, ctx),
      [TOOL_NAMES.suggestComponents]: (args, ctx) => this.suggestComponents(args, ctx),
      [TOOL_NAMES.selectComponent]: (args, ctx) => this.selectComponent(args, ctx),
      [TOOL_NAMES.removeComponent]: (args, ctx) => this.removeComponent(args, ctx),
      [TOOL_NAMES.skipGpu]: (_args, ctx) => this.skipGpu(ctx),
      [TOOL_NAMES.viewBuild]: (_args, ctx) => this.viewBuild(ctx),
      [TOOL_NAMES.registerVisit]: (args, ctx) => this.registerVisit(args, ctx),
    };
  }

  async execute(name: string, args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const handler = this.handlers[name];
    if (handler === undefined) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Herramienta desconocida: ${name}`, details: null } };
    }
    try {
      const data = await handler(args, ctx);
      this.deps.log.debug('Herramienta ejecutada', { tool: name, session: ctx.session.key });
      return { ok: true, ...data };
    } catch (error) {
      if (error instanceof AppError) {
        this.deps.log.info('Herramienta devolvio error de negocio', { tool: name, code: error.code });
        return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
      }
      this.deps.log.error('Herramienta fallo inesperadamente', { tool: name, error });
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Error interno al ejecutar la herramienta', details: null },
      };
    }
  }

  // --------------------------------------------------------- catalogo

  private async searchProducts(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const category = reqEnum(args, 'categoria', PRODUCT_CATEGORIES);
    const outcome = await this.deps.catalog.search({
      category,
      maxPriceUsd: optNumber(args, 'presupuesto_max_usd', { min: 1, max: 50_000 }),
      preference: optString(args, 'preferencia', { max: 80 }),
      text: optString(args, 'texto', { max: 80 }),
    });
    const shown = allowDisplay(ctx, outcome.products);
    return {
      category,
      products: shown.map(productView),
      preferenceIgnored: outcome.preferenceIgnored,
      note:
        shown.length === 0
          ? 'Sin resultados en stock con esos criterios: propone ajustar presupuesto o preferencia'
          : 'Presenta como maximo estas opciones y pregunta cual prefiere el cliente',
    };
  }

  private async lookupProduct(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const outcome = await this.deps.catalog.lookup(reqString(args, 'texto', { max: 80 }));
    if (!outcome.found || outcome.match === null) {
      return { found: false, note: 'No hay coincidencias: pide al cliente el modelo exacto o mas detalles' };
    }
    const shown = allowDisplay(ctx, [outcome.match, ...outcome.alternatives, ...outcome.similar]);
    const [match, ...others] = shown;
    const alternatives = others.filter((p) => outcome.alternatives.some((a) => a.sku === p.sku));
    const similar = others.filter((p) => outcome.similar.some((s) => s.sku === p.sku));
    return {
      found: true,
      available: outcome.available,
      product: match ? productView(match) : null,
      alternatives: alternatives.map(productView),
      similar: similar.map(productView),
      note: outcome.available
        ? 'Informa precio exacto y disponibilidad'
        : 'Esta AGOTADO: dilo con claridad y ofrece solo las alternativas listadas',
    };
  }

  // ----------------------------------------------------- armado de PC

  private async startBuild(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const progress = this.deps.engine.start(ctx.session.build, {
      purpose: reqEnum(args, 'proposito', ['gaming', 'creation', 'office'] as const),
      budgetUsd: reqNumber(args, 'presupuesto_usd', { min: 1 }),
      reset: optBoolean(args, 'reiniciar'),
    });
    return { progress, note: 'Siguiente paso: llama a sugerir_componentes' };
  }

  private async suggestComponents(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const requested = optEnum(args, 'categoria', BUILD_CATEGORIES);
    const result = await this.deps.engine.suggest(ctx.session.build, requested);
    const shown = allowDisplay(ctx, result.options);
    return {
      category: result.category,
      budgetForCategoryUsd: result.budgetForCategoryUsd,
      overBudget: result.overBudget,
      options: shown.map((o) => ({ tier: o.tier, ...productView(o.product) })),
      progress: this.deps.engine.progress(ctx.session.build),
      note: result.note,
    };
  }

  private async selectComponent(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const { progress, warnings } = await this.deps.engine.select(ctx.session.build, reqString(args, 'sku', { max: 80 }));
    return {
      progress,
      warnings: warnings.map((w) => w.message),
      note: progress.nextStep === null ? 'Armado completo: presenta el resumen con ver_armado' : 'Continua con el siguiente paso',
    };
  }

  private async removeComponent(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    const category = reqEnum(args, 'categoria', BUILD_CATEGORIES);
    return { progress: this.deps.engine.remove(ctx.session.build, category) };
  }

  private async skipGpu(ctx: ToolContext): Promise<Record<string, unknown>> {
    return { progress: this.deps.engine.skipGpu(ctx.session.build) };
  }

  private async viewBuild(ctx: ToolContext): Promise<Record<string, unknown>> {
    const summary = await this.deps.engine.summarize(ctx.session.build);
    return {
      summary,
      note: summary.complete
        ? 'Presenta: lista con precios, servicios de montaje desglosados, total, tiempo de entrega e invita a visitar la tienda'
        : 'El armado esta incompleto: continua con el siguiente paso',
    };
  }

  // ------------------------------------------------------------ leads

  private async registerVisit(args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
    if (ctx.channel === 'mercadolibre') {
      throw new AppError(
        'CHANNEL_RESTRICTED',
        'En Mercado Libre no se registran datos de contacto ni visitas: invita a comprar desde la publicacion',
        403,
      );
    }
    const customerName = reqString(args, 'nombre_cliente', { min: 2, max: 80 });
    const phone = reqString(args, 'telefono', { max: 25 });
    if (!PHONE_RE.test(phone) || (phone.match(/\d/g) ?? []).length < 7) {
      throw new AppError('VALIDATION_ERROR', 'El telefono no parece valido: pidele que lo confirme', 400, {
        field: 'telefono',
      });
    }

    let quote: QuoteSnapshot | null = null;
    if (this.deps.engine.isComplete(ctx.session.build)) {
      quote = await this.deps.engine.buildQuote(ctx.session.build);
    }

    const lead = await this.deps.repo.createLead({
      customerName,
      phone,
      channel: ctx.channel,
      externalUserId: ctx.session.key,
      preferredVisit: optString(args, 'fecha_preferida', { max: 120 }),
      notes: optString(args, 'notas', { max: 500 }),
      quote,
    });
    ctx.session.customer = { name: customerName, phone };

    const { store } = this.deps;
    return {
      leadId: lead.id,
      includesQuote: quote !== null,
      store: {
        name: store.name,
        city: store.city,
        ...(store.address !== '' ? { address: store.address } : {}),
        ...(store.hours !== '' ? { hours: store.hours } : {}),
      },
      note: 'Confirma al cliente que quedo registrado y comparte unicamente los datos de la tienda que aparecen aqui',
    };
  }
}
