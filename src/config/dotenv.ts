import fs from 'node:fs';
import path from 'node:path';

/**
 * Cargador de .env propio (sin dependencias) pensado para Windows.
 *
 * Por que no basta process.loadEnvFile: ante un .env guardado con BOM UTF-8 (Bloc de notas, PowerShell 5.1
 * con -Encoding utf8) la primera variable queda con el nombre "﻿GEMINI_API_KEY", y ante UTF-16
 * (PowerShell `>` / `Out-File`) no se lee nada. En ambos casos fallaba en silencio.
 *
 * Reglas: una variable ya definida y NO vacia en el entorno real (PowerShell, Docker, systemd) siempre gana;
 * una definida pero vacia se rellena desde el archivo. Nunca se registran valores, solo nombres.
 */

export type EnvFileEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be';

export interface ParsedEnvFile {
  values: Record<string, string>;
  warnings: string[];
}

export interface DotEnvReport {
  /** Archivo cargado (null si no se encontro ninguno). */
  path: string | null;
  /** Rutas donde se busco, en orden. */
  searched: string[];
  encoding: EnvFileEncoding | null;
  /** Variables tomadas del archivo (aplicadas al entorno). */
  appliedKeys: string[];
  /** Variables del archivo ignoradas porque el entorno real ya las tenia con valor. */
  keptFromEnvironment: string[];
  warnings: string[];
}

export interface LoadDotEnvOptions {
  /** Nombre del archivo (por defecto ".env"). */
  fileName?: string;
  /** Carpeta de trabajo (por defecto process.cwd()). */
  cwd?: string;
  /** Raiz del proyecto (por defecto, dos niveles sobre este modulo: src/config o dist/config). */
  projectRoot?: string;
  /** Entorno a modificar (por defecto process.env). */
  env?: NodeJS.ProcessEnv;
}

/** Decodifica el archivo detectando BOM UTF-8/UTF-16 y UTF-16 sin BOM. */
export function decodeEnvFile(buffer: Buffer): { text: string; encoding: EnvFileEncoding } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2));
    body.swap16();
    return { text: body.toString('utf16le'), encoding: 'utf16be' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8-bom' };
  }
  // UTF-16 sin BOM: texto ASCII con un byte nulo cada dos.
  if (buffer.length >= 4) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 64));
    let oddZeros = 0;
    let evenZeros = 0;
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] === 0) {
        if (i % 2 === 1) oddZeros += 1;
        else evenZeros += 1;
      }
    }
    const pairs = Math.floor(sample.length / 2);
    if (oddZeros * 2 >= pairs && evenZeros === 0) return { text: buffer.toString('utf16le'), encoding: 'utf16le' };
    if (evenZeros * 2 >= pairs && oddZeros === 0) {
      const body = Buffer.from(buffer);
      body.swap16();
      return { text: body.toString('utf16le'), encoding: 'utf16be' };
    }
  }
  return { text: buffer.toString('utf8'), encoding: 'utf8' };
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

function parseValue(raw: string): { value: string; warning: string | null } {
  const text = raw.trimStart();
  const quote = text[0];
  if (quote === '"' || quote === "'" || quote === '`') {
    let value = '';
    for (let i = 1; i < text.length; i += 1) {
      const ch = text.charAt(i);
      if (quote === '"' && ch === '\\' && i + 1 < text.length) {
        const next = text.charAt(i + 1);
        value += ESCAPES[next] ?? `\\${next}`;
        i += 1;
        continue;
      }
      if (ch === quote) return { value, warning: null };
      value += ch;
    }
    // Comilla sin cerrar: se toma el resto de la linea tal cual (sin la comilla inicial).
    return { value: text.slice(1).trimEnd(), warning: 'comilla sin cerrar' };
  }
  // Sin comillas: un "#" precedido de espacio inicia un comentario.
  const hash = text.search(/\s#/);
  return { value: (hash === -1 ? text : text.slice(0, hash)).trim(), warning: null };
}

/** Interpreta el texto de un .env. No interpola variables ni ejecuta nada ("$" es literal). */
export function parseDotEnv(input: string): ParsedEnvFile {
  const values: Record<string, string> = {};
  const warnings: string[] = [];
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  text.split(/\r\n|\n|\r/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const eq = body.indexOf('=');
    if (eq <= 0) {
      warnings.push(`linea ${index + 1}: no tiene el formato CLAVE=valor y se ignoro`);
      return;
    }
    const key = body.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) {
      warnings.push(`linea ${index + 1}: nombre de variable invalido y se ignoro`);
      return;
    }
    const parsed = parseValue(body.slice(eq + 1));
    if (parsed.warning !== null) warnings.push(`linea ${index + 1} (${key}): ${parsed.warning}`);
    values[key] = parsed.value;
  });

  return { values, warnings };
}

/** Rutas candidatas: carpeta de trabajo primero y despues la raiz del proyecto (sin duplicados). */
export function envFileCandidates(options: LoadDotEnvOptions = {}): string[] {
  const fileName = options.fileName ?? '.env';
  const cwd = options.cwd ?? process.cwd();
  const root = options.projectRoot ?? path.resolve(__dirname, '..', '..');
  return [...new Set([path.resolve(cwd, fileName), path.resolve(root, fileName)])];
}

/** Busca y carga el primer .env existente. Nunca lanza: los problemas se devuelven en el informe. */
export function loadDotEnv(options: LoadDotEnvOptions = {}): DotEnvReport {
  const env = options.env ?? process.env;
  const searched = envFileCandidates(options);
  const report: DotEnvReport = {
    path: null,
    searched,
    encoding: null,
    appliedKeys: [],
    keptFromEnvironment: [],
    warnings: [],
  };

  const file = searched.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (file === undefined) return report;
  report.path = file;

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (error) {
    report.warnings.push(`no se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }

  const decoded = decodeEnvFile(buffer);
  report.encoding = decoded.encoding;
  if (decoded.encoding !== 'utf8') {
    report.warnings.push(`el archivo estaba en ${decoded.encoding}; se leyo bien, pero conviene guardarlo como UTF-8 sin BOM`);
  }

  const parsed = parseDotEnv(decoded.text);
  report.warnings.push(...parsed.warnings);

  for (const [key, value] of Object.entries(parsed.values)) {
    const current = env[key];
    if (current !== undefined && current.trim() !== '') {
      report.keptFromEnvironment.push(key);
      continue;
    }
    env[key] = value;
    report.appliedKeys.push(key);
  }
  return report;
}
