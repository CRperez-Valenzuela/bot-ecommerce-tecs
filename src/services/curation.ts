/** Maximo de opciones de producto que se pueden mostrar en un mismo mensaje. */
export const MAX_PRODUCTS_PER_REPLY = 3;

/**
 * Elige hasta `max` opciones repartidas a lo largo del rango de precio
 * (la mas alta, una intermedia y la mas baja) para ofrecer alternativas reales
 * y no tres productos casi identicos. Devuelve de mayor a menor precio.
 */
export function pickSpread<T extends { priceUsd: number }>(items: T[], max = MAX_PRODUCTS_PER_REPLY): T[] {
  const sorted = [...items].sort((a, b) => b.priceUsd - a.priceUsd);
  if (sorted.length <= max) return sorted;
  if (max <= 1) return sorted.slice(0, 1);
  if (max === 2) return [sorted[0], sorted[sorted.length - 1]] as T[];
  const middle = sorted[Math.floor((sorted.length - 1) / 2)] as T;
  return [sorted[0] as T, middle, sorted[sorted.length - 1] as T];
}

export function tierLabels(count: number): string[] {
  if (count <= 1) return ['recomendada'];
  if (count === 2) return ['mejor rendimiento', 'ahorro'];
  return ['mejor rendimiento', 'equilibrada', 'ahorro'];
}
