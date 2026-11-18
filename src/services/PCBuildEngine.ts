import type { IInventoryRepository } from '../repositories/IInventoryRepository';
import type {
  BuildCategory,
  BuildPurpose,
  BuildSelection,
  PCBuildState,
  Product,
  QuoteLine,
  QuoteSnapshot,
  ServiceItem,
  SpecFilter,
} from '../types/domain';
import { BUILD_CATEGORIES } from '../types/domain';
import { AppError } from '../utils/errors';
import { round2 } from '../utils/text';
import type { BuildComponents, CompatIssue } from './compatibility';
import { blockingIssuesFor, evaluateBuild } from './compatibility';
import { pickSpread, tierLabels } from './curation';

/** Reparto del presupuesto (sin servicios) por proposito. Cada fila suma 1. */
const BUDGET_RATIOS: Record<BuildPurpose, Record<BuildCategory, number>> = {
  gaming: { cpu: 0.2, motherboard: 0.12, ram: 0.09, storage: 0.08, gpu: 0.35, psu: 0.08, case: 0.08 },
  creation: { cpu: 0.26, motherboard: 0.13, ram: 0.14, storage: 0.1, gpu: 0.2, psu: 0.09, case: 0.08 },
  office: { cpu: 0.26, motherboard: 0.16, ram: 0.13, storage: 0.15, gpu: 0.1, psu: 0.1, case: 0.1 },
};

const REQUIRED_SERVICE_KINDS = ['assembly', 'cable_management', 'os_setup'] as const;
const SERVICES_CACHE_MS = 60_000;
const MIN_BUDGET_USD = 50;
const MAX_BUDGET_USD = 20_000;

export interface StartBuildInput {
  purpose: BuildPurpose;
  budgetUsd: number;
  /** Descarta los componentes ya elegidos. */
  reset?: boolean;
}

export interface BuildProgress {
  purpose: BuildPurpose | null;
  budgetUsd: number | null;
  selected: BuildSelection[];
  nextStep: BuildCategory | null;
  remainingSteps: BuildCategory[];
  /** true si el procesador elegido tiene video integrado y se puede omitir la GPU. */
  gpuOptional: boolean;
  spentUsd: number;
}

export interface SuggestedOption {
  product: Product;
  tier: string;
}

export interface SuggestionResult {
  category: BuildCategory | null;
  budgetForCategoryUsd: number;
  options: SuggestedOption[];
  /** true si no habia nada dentro del presupuesto y se muestran las opciones mas economicas. */
  overBudget: boolean;
  note: string;
}

export interface BuildSummary extends QuoteSnapshot {
  complete: boolean;
  missing: BuildCategory[];
  issues: CompatIssue[];
  /** total - presupuesto (positivo = excede). null si no hay presupuesto. */
  budgetDeltaUsd: number | null;
}

export function createEmptyBuild(now: Date = new Date()): PCBuildState {
  const stamp = now.toISOString();
  return { purpose: null, budgetUsd: null, components: {}, gpuSkipped: false, createdAt: stamp, updatedAt: stamp };
}

function toLine(product: Product): QuoteLine {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category as BuildCategory,
    priceUsd: product.priceUsd,
  };
}

/**
 * Motor de armado de PC. Trabaja sobre el estado en memoria de la sesion y consulta
 * catalogo/servicios unicamente a traves de IInventoryRepository.
 */
export class PCBuildEngine {
  private servicesCache: { at: number; items: ServiceItem[] } | null = null;

  constructor(
    private readonly repo: IInventoryRepository,
    private readonly deliveryEta: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------- estado

  start(build: PCBuildState, input: StartBuildInput): BuildProgress {
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < MIN_BUDGET_USD || input.budgetUsd > MAX_BUDGET_USD) {
      throw new AppError(
        'VALIDATION_ERROR',
        `El presupuesto debe estar entre ${MIN_BUDGET_USD} y ${MAX_BUDGET_USD} USD`,
        400,
        { field: 'budgetUsd' },
      );
    }
    if (input.reset === true) {
      build.components = {};
      build.gpuSkipped = false;
    }
    build.purpose = input.purpose;
    build.budgetUsd = round2(input.budgetUsd);
    this.touch(build);
    return this.progress(build);
  }

  progress(build: PCBuildState): BuildProgress {
    const selected: BuildSelection[] = BUILD_CATEGORIES.flatMap((category) => {
      const product = build.components[category];
      return product ? [{ category, sku: product.sku, name: product.name, priceUsd: product.priceUsd }] : [];
    });
    const remainingSteps = this.missingSteps(build);
    return {
      purpose: build.purpose,
      budgetUsd: build.budgetUsd,
      selected,
      nextStep: remainingSteps[0] ?? null,
      remainingSteps,
      gpuOptional: build.components.cpu?.specs.igpu === true,
      spentUsd: round2(selected.reduce((sum, s) => sum + s.priceUsd, 0)),
    };
  }

  isComplete(build: PCBuildState): boolean {
    return this.missingSteps(build).length === 0;
  }

  // ------------------------------------------------------- sugerencias

  async suggest(build: PCBuildState, requested?: BuildCategory): Promise<SuggestionResult> {
    if (build.purpose === null || build.budgetUsd === null) {
      throw new AppError(
        'BUILD_PROFILE_INCOMPLETE',
        'Antes de sugerir componentes pregunta el proposito (gaming, creacion u oficina) y el presupuesto, y llama a iniciar_armado_pc',
        409,
      );
    }
    const category = requested ?? this.missingSteps(build)[0] ?? null;
    if (category === null) {
      return {
        category: null,
        budgetForCategoryUsd: 0,
        options: [],
        overBudget: false,
        note: 'El armado ya tiene todos los componentes: presenta el resumen con ver_armado',
      };
    }

    const budgetForCategoryUsd = await this.categoryBudget(build, category);
    const spec = this.specFilterFor(build, category);
    const compatible = async (candidates: Product[]): Promise<Product[]> =>
      candidates.filter((p) => blockingIssuesFor(build.components, p).length === 0);

    let overBudget = false;
    let pool = await compatible(
      await this.repo.searchProducts({ category, maxPriceUsd: budgetForCategoryUsd, spec, sort: 'price_desc' }),
    );
    if (pool.length === 0) {
      overBudget = true;
      pool = (
        await compatible(await this.repo.searchProducts({ category, spec, sort: 'price_asc' }))
      ).slice(0, 2);
    }

    const picked = pickSpread(pool);
    const tiers = tierLabels(picked.length);
    const options = picked.map((product, index) => ({ product, tier: tiers[index] ?? 'opcion' }));

    let note = 'Presenta estas opciones (maximo 3) y espera la eleccion del cliente';
    if (options.length === 0) {
      note =
        'No hay opciones compatibles en stock para este paso; sugiere ajustar el presupuesto o cambiar un componente previo';
    } else if (overBudget) {
      note = 'Nada entra en el presupuesto de este paso: explica que son las opciones mas economicas disponibles';
    }
    return { category, budgetForCategoryUsd, options, overBudget, note };
  }

  // ------------------------------------------------- seleccion de piezas

  async select(build: PCBuildState, sku: string): Promise<{ progress: BuildProgress; warnings: CompatIssue[] }> {
    const product = await this.repo.getProductBySku(sku);
    if (product === null) {
      throw new AppError('COMPONENT_NOT_FOUND', `No existe un producto con SKU "${sku}"`, 404, { sku });
    }
    if (product.category === 'laptop') {
      throw new AppError('VALIDATION_ERROR', 'Las laptops no forman parte de un armado de PC', 400, { sku });
    }
    if (product.stock <= 0) {
      throw new AppError('OUT_OF_STOCK', `"${product.name}" esta agotado`, 409, { sku });
    }

    const blocking = blockingIssuesFor(build.components, product);
    if (blocking.length > 0) {
      throw new AppError('INCOMPATIBLE_COMPONENT', 'El componente no es compatible con el armado actual', 409, {
        sku,
        problemas: blocking.map((i) => ({ code: i.code, message: i.message })),
        sugerencia: 'Ofrece una alternativa compatible con sugerir_componentes o quita el componente en conflicto',
      });
    }

    const category = product.category as BuildCategory;
    build.components[category] = product;
    if (category === 'gpu') build.gpuSkipped = false;
    this.touch(build);

    return {
      progress: this.progress(build),
      warnings: evaluateBuild(build.components).filter((i) => i.severity === 'warning'),
    };
  }

  remove(build: PCBuildState, category: BuildCategory): BuildProgress {
    delete build.components[category];
    if (category === 'gpu') build.gpuSkipped = false;
    this.touch(build);
    return this.progress(build);
  }

  /** Arma sin tarjeta de video dedicada (solo si el procesador tiene graficos integrados). */
  skipGpu(build: PCBuildState): BuildProgress {
    const cpu = build.components.cpu;
    if (cpu === undefined) {
      throw new AppError('BUILD_INCOMPLETE', 'Primero elige el procesador para saber si tiene video integrado', 409);
    }
    if (cpu.specs.igpu !== true) {
      throw new AppError(
        'INCOMPATIBLE_COMPONENT',
        'El procesador elegido no tiene graficos integrados: se necesita una tarjeta de video',
        409,
        { cpu: cpu.sku },
      );
    }
    delete build.components.gpu;
    build.gpuSkipped = true;
    this.touch(build);
    return this.progress(build);
  }

  // --------------------------------------------------------- cotizacion

  async summarize(build: PCBuildState): Promise<BuildSummary> {
    const missing = this.missingSteps(build);
    const complete = missing.length === 0;

    const items = BUILD_CATEGORIES.flatMap((c) => {
      const product = build.components[c];
      return product ? [toLine(product)] : [];
    });
    const services = complete ? (await this.requiredServices()).map(serviceLine) : [];

    const subtotalUsd = round2(items.reduce((sum, l) => sum + l.priceUsd, 0));
    const servicesUsd = round2(services.reduce((sum, l) => sum + l.priceUsd, 0));
    const totalUsd = round2(subtotalUsd + servicesUsd);

    return {
      purpose: build.purpose,
      budgetUsd: build.budgetUsd,
      items,
      services,
      subtotalUsd,
      servicesUsd,
      totalUsd,
      deliveryEta: this.deliveryEta,
      complete,
      missing,
      issues: evaluateBuild(build.components),
      budgetDeltaUsd: build.budgetUsd === null ? null : round2(totalUsd - build.budgetUsd),
    };
  }

  /** Cotizacion final lista para registrar en el lead. Exige armado completo y sin conflictos. */
  async buildQuote(build: PCBuildState): Promise<QuoteSnapshot> {
    const summary = await this.summarize(build);
    if (!summary.complete) {
      throw new AppError('BUILD_INCOMPLETE', 'El armado aun no esta completo', 409, { faltan: summary.missing });
    }
    const errors = summary.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new AppError('INCOMPATIBLE_COMPONENT', 'El armado tiene incompatibilidades', 409, {
        problemas: errors.map((i) => i.message),
      });
    }
    const { complete: _complete, missing: _missing, issues: _issues, budgetDeltaUsd: _delta, ...quote } = summary;
    return quote;
  }

  // ------------------------------------------------------------ privado

  private missingSteps(build: PCBuildState): BuildCategory[] {
    return BUILD_CATEGORIES.filter((c) => !(c === 'gpu' && build.gpuSkipped) && build.components[c] === undefined);
  }

  private touch(build: PCBuildState): void {
    build.updatedAt = new Date(this.now()).toISOString();
  }

  private specFilterFor(build: PCBuildState, category: BuildCategory): SpecFilter {
    // Filtros que el repositorio resuelve del lado de datos; el resto se valida con blockingIssuesFor.
    const c: BuildComponents = build.components;
    const spec: SpecFilter = {};
    if (category === 'cpu' && c.motherboard?.specs.socket) spec.socket = c.motherboard.specs.socket;
    if (category === 'motherboard') {
      if (c.cpu?.specs.socket) spec.socket = c.cpu.specs.socket;
      if (c.ram?.specs.memory_type) spec.memoryType = c.ram.specs.memory_type;
    }
    if (category === 'ram' && c.motherboard?.specs.memory_type) spec.memoryType = c.motherboard.specs.memory_type;
    if (category === 'case' && c.motherboard?.specs.form_factor) {
      spec.supportsFormFactor = c.motherboard.specs.form_factor;
    }
    return spec;
  }

  /** Presupuesto disponible para una categoria, redistribuyendo lo ya gastado. */
  private async categoryBudget(build: PCBuildState, category: BuildCategory): Promise<number> {
    const budget = build.budgetUsd ?? 0;
    const purpose = build.purpose ?? 'gaming';
    const ratios = BUDGET_RATIOS[purpose];
    const servicesUsd = await this.estimateServicesUsd();

    const spentElsewhere = BUILD_CATEGORIES.reduce(
      (sum, c) => sum + (c === category ? 0 : (build.components[c]?.priceUsd ?? 0)),
      0,
    );
    const pool = Math.max(budget - servicesUsd - spentElsewhere, 0);
    const pending = BUILD_CATEGORIES.filter(
      (c) => c === category || (build.components[c] === undefined && !(c === 'gpu' && build.gpuSkipped)),
    );
    const weight = pending.reduce((sum, c) => sum + ratios[c], 0);
    return round2(weight === 0 ? pool : (pool * ratios[category]) / weight);
  }

  private async requiredServices(): Promise<ServiceItem[]> {
    const now = this.now();
    if (this.servicesCache === null || now - this.servicesCache.at > SERVICES_CACHE_MS) {
      this.servicesCache = { at: now, items: await this.repo.listServices() };
    }
    const all = this.servicesCache.items;
    return REQUIRED_SERVICE_KINDS.flatMap((kind) => {
      const found = all.find((s) => s.kind === kind);
      return found ? [found] : [];
    });
  }

  private async estimateServicesUsd(): Promise<number> {
    return round2((await this.requiredServices()).reduce((sum, s) => sum + s.priceUsd, 0));
  }
}

function serviceLine(service: ServiceItem): QuoteLine {
  return {
    productId: service.id,
    sku: service.sku,
    name: service.name,
    category: 'service',
    priceUsd: service.priceUsd,
  };
}
