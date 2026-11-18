/** Modo de la capa de datos: demostracion independiente o Odoo real. */
export type OdooMode = 'mock' | 'live';

/** Canales de atencion. `web` es el simulador/demo (se comporta como WhatsApp). */
export type Channel = 'whatsapp' | 'instagram' | 'mercadolibre' | 'web';

export const PRODUCT_CATEGORIES = [
  'cpu',
  'motherboard',
  'ram',
  'storage',
  'gpu',
  'psu',
  'case',
  'laptop',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Categorias que componen una PC armada, en el orden del flujo guiado. */
export const BUILD_CATEGORIES = ['cpu', 'motherboard', 'ram', 'storage', 'gpu', 'psu', 'case'] as const;
export type BuildCategory = (typeof BUILD_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

export function isBuildCategory(value: unknown): value is BuildCategory {
  return typeof value === 'string' && (BUILD_CATEGORIES as readonly string[]).includes(value);
}

export type SpecValue = string | number | boolean | string[];

/**
 * Especificaciones tecnicas normalizadas (claves en snake_case).
 * En Odoo se leen de lineas "clave: valor" del campo de especificaciones.
 */
export interface ProductSpecs {
  socket?: string;
  memory_type?: string;
  form_factor?: string;
  form_factors?: string[];
  chipset?: string;
  cores?: number;
  threads?: number;
  tdp_w?: number;
  igpu?: boolean;
  capacity_gb?: number;
  speed_mhz?: number;
  kind?: string;
  vram_gb?: number;
  gpu_length_mm?: number;
  max_gpu_length_mm?: number;
  recommended_psu_w?: number;
  wattage_w?: number;
  certification?: string;
  style?: string;
  color?: string;
  usage?: string;
  [key: string]: SpecValue | undefined;
}

export interface Product {
  /** Identificador interno (en Odoo: id de product.template). */
  id: string;
  /** Codigo comercial (en Odoo: default_code). */
  sku: string;
  name: string;
  brand: string;
  category: ProductCategory;
  priceUsd: number;
  stock: number;
  specs: ProductSpecs;
  tags: string[];
  summary: string;
}

export type ServiceKind = 'assembly' | 'cable_management' | 'os_setup' | 'other';

export interface ServiceItem {
  id: string;
  sku: string;
  name: string;
  kind: ServiceKind;
  priceUsd: number;
  description: string;
}

/** Filtros tecnicos que los repositorios resuelven del lado de datos. */
export interface SpecFilter {
  socket?: string;
  memoryType?: string;
  /** Formato exacto de placa madre (ej. "mATX"). */
  formFactor?: string;
  /** Case que soporte placas de este formato (ej. "ATX"). */
  supportsFormFactor?: string;
}

export interface ProductSearchQuery {
  category?: ProductCategory;
  /** Texto libre del cliente (todas las palabras deben coincidir). */
  text?: string;
  /** Palabras de preferencia (basta con que coincida alguna). */
  keywords?: string[];
  minPriceUsd?: number;
  maxPriceUsd?: number;
  spec?: SpecFilter;
  sort?: 'price_asc' | 'price_desc';
  /** Se recorta siempre a MAX_REPO_RESULTS (5). */
  limit?: number;
}

export type BuildPurpose = 'gaming' | 'creation' | 'office';

export interface BuildSelection {
  category: BuildCategory;
  sku: string;
  name: string;
  priceUsd: number;
}

/** Estado JSON del carrito de armado de PC, uno por sesion. */
export interface PCBuildState {
  purpose: BuildPurpose | null;
  budgetUsd: number | null;
  components: Partial<Record<BuildCategory, Product>>;
  gpuSkipped: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteLine {
  productId: string;
  sku: string;
  name: string;
  category: BuildCategory | 'service';
  priceUsd: number;
}

export interface QuoteSnapshot {
  purpose: BuildPurpose | null;
  budgetUsd: number | null;
  items: QuoteLine[];
  services: QuoteLine[];
  subtotalUsd: number;
  servicesUsd: number;
  totalUsd: number;
  deliveryEta: string;
}

export interface LeadInput {
  customerName: string;
  phone: string;
  channel: Channel;
  externalUserId?: string;
  /** Texto libre (ej. "sabado por la tarde") o fecha ISO YYYY-MM-DD. */
  preferredVisit?: string;
  notes?: string;
  quote?: QuoteSnapshot | null;
}

export interface LeadRecord {
  id: string;
  mode: OdooMode;
  createdAt: string;
  quotationId: string | null;
}
