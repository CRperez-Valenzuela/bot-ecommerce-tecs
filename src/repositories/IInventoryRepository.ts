import type {
  LeadInput,
  LeadRecord,
  OdooMode,
  Product,
  ProductSearchQuery,
  ServiceItem,
} from '../types/domain';

/** Limite estricto de registros por consulta interna (regla de curaduria comercial). */
export const MAX_REPO_RESULTS = 5;

export interface RepositoryHealth {
  ok: boolean;
  mode: OdooMode;
  detail: string;
}

/**
 * Contrato unico de acceso a datos. La logica de negocio (curaduria, armado de PC,
 * compatibilidad) vive en servicios y NUNCA depende de la implementacion concreta.
 */
export interface IInventoryRepository {
  readonly mode: OdooMode;

  healthCheck(): Promise<RepositoryHealth>;

  /**
   * Busqueda de catalogo. SIEMPRE filtra stock > 0 y devuelve como maximo
   * MAX_REPO_RESULTS registros.
   */
  searchProducts(query: ProductSearchQuery): Promise<Product[]>;

  /**
   * Identificacion de un producto puntual por nombre/modelo/SKU. Excepcion
   * deliberada al filtro de stock: permite informar "agotado" con precio exacto.
   * Maximo MAX_REPO_RESULTS registros, ordenados por relevancia.
   */
  lookupByName(text: string): Promise<Product[]>;

  /** Producto por SKU exacto, con su stock real (puede ser 0). */
  getProductBySku(sku: string): Promise<Product | null>;

  /** Servicios de ensamblaje/configuracion (no tienen stock). */
  listServices(): Promise<ServiceItem[]>;

  /** Registra el lead / oportunidad de visita en tienda. */
  createLead(input: LeadInput): Promise<LeadRecord>;
}
