import type { BuildCategory, Product } from '../types/domain';

export type BuildComponents = Partial<Record<BuildCategory, Product>>;

export type CompatIssueCode =
  | 'SOCKET_MISMATCH'
  | 'MEMORY_MISMATCH'
  | 'FORM_FACTOR_MISMATCH'
  | 'GPU_TOO_LONG'
  | 'PSU_UNDERPOWERED'
  | 'COMPAT_UNVERIFIED';

export interface CompatIssue {
  code: CompatIssueCode;
  severity: 'error' | 'warning';
  message: string;
  /** Categorias involucradas: sirve para saber si un candidato es el causante. */
  categories: BuildCategory[];
}

/** Margen para perifericos, ventiladores y picos de consumo. */
const PSU_HEADROOM_W = 120;
const DEFAULT_CPU_TDP_W = 65;

function sameValue(a: string | undefined, b: string | undefined): 'ok' | 'mismatch' | 'unknown' {
  if (a === undefined || b === undefined) return 'unknown';
  return a.toLowerCase() === b.toLowerCase() ? 'ok' : 'mismatch';
}

/** Potencia minima recomendada de fuente para la combinacion actual. */
export function estimateRequiredPsuW(components: BuildComponents): number {
  const cpuTdp = components.cpu?.specs.tdp_w ?? DEFAULT_CPU_TDP_W;
  const gpuTdp = components.gpu?.specs.tdp_w ?? 0;
  const estimated = Math.ceil((cpuTdp + gpuTdp + PSU_HEADROOM_W) / 50) * 50;
  return Math.max(estimated, components.gpu?.specs.recommended_psu_w ?? 0);
}

/** Evalua la compatibilidad de los componentes presentes (los ausentes no generan problemas). */
export function evaluateBuild(components: BuildComponents): CompatIssue[] {
  const issues: CompatIssue[] = [];
  const { cpu, motherboard: board, ram, gpu, psu, case: pcCase } = components;

  const unverified = (what: string, categories: BuildCategory[]): void => {
    issues.push({
      code: 'COMPAT_UNVERIFIED',
      severity: 'warning',
      message: `No se pudo verificar ${what}: faltan especificaciones en el catalogo`,
      categories,
    });
  };

  if (cpu && board) {
    const result = sameValue(cpu.specs.socket, board.specs.socket);
    if (result === 'mismatch') {
      issues.push({
        code: 'SOCKET_MISMATCH',
        severity: 'error',
        message: `El procesador (${cpu.specs.socket}) no es compatible con la placa madre (${board.specs.socket})`,
        categories: ['cpu', 'motherboard'],
      });
    } else if (result === 'unknown') {
      unverified('el socket procesador/placa', ['cpu', 'motherboard']);
    }
  }

  if (ram && board) {
    const result = sameValue(ram.specs.memory_type, board.specs.memory_type);
    if (result === 'mismatch') {
      issues.push({
        code: 'MEMORY_MISMATCH',
        severity: 'error',
        message: `La memoria (${ram.specs.memory_type}) no es compatible con la placa madre (${board.specs.memory_type})`,
        categories: ['ram', 'motherboard'],
      });
    } else if (result === 'unknown') {
      unverified('el tipo de memoria RAM/placa', ['ram', 'motherboard']);
    }
  }

  if (board && pcCase) {
    const format = board.specs.form_factor;
    const supported = pcCase.specs.form_factors;
    if (format === undefined || supported === undefined) {
      unverified('el formato placa/case', ['motherboard', 'case']);
    } else if (!supported.some((f) => f.toLowerCase() === format.toLowerCase())) {
      issues.push({
        code: 'FORM_FACTOR_MISMATCH',
        severity: 'error',
        message: `La placa ${format} no cabe en este case (admite: ${supported.join(', ')})`,
        categories: ['motherboard', 'case'],
      });
    }
  }

  if (gpu && pcCase) {
    const length = gpu.specs.gpu_length_mm;
    const maxLength = pcCase.specs.max_gpu_length_mm;
    if (length === undefined || maxLength === undefined) {
      unverified('el largo de la tarjeta de video', ['gpu', 'case']);
    } else if (length > maxLength) {
      issues.push({
        code: 'GPU_TOO_LONG',
        severity: 'error',
        message: `La tarjeta de video mide ${length} mm y el case admite hasta ${maxLength} mm`,
        categories: ['gpu', 'case'],
      });
    }
  }

  if (psu && (cpu || gpu)) {
    const watts = psu.specs.wattage_w;
    const required = estimateRequiredPsuW(components);
    if (watts === undefined) {
      unverified('la potencia de la fuente', ['psu']);
    } else if (watts < required) {
      issues.push({
        code: 'PSU_UNDERPOWERED',
        severity: 'error',
        message: `La fuente de ${watts} W es insuficiente: se recomiendan al menos ${required} W para esta combinacion`,
        categories: ['psu', 'cpu', 'gpu'],
      });
    }
  }

  return issues;
}

/** Errores bloqueantes que provoca agregar `candidate` al armado actual. */
export function blockingIssuesFor(components: BuildComponents, candidate: Product): CompatIssue[] {
  if (!isBuildCategoryKey(candidate.category)) return [];
  const category = candidate.category;
  const next: BuildComponents = { ...components, [category]: candidate };
  return evaluateBuild(next).filter((i) => i.severity === 'error' && i.categories.includes(category));
}

function isBuildCategoryKey(category: Product['category']): category is BuildCategory {
  return category !== 'laptop';
}
