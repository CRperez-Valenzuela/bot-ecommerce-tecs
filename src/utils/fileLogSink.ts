import fs from 'node:fs';
import path from 'node:path';
import type { LogSink } from './logger';

export interface FileLogSinkOptions {
  dir: string;
  /** Dias de archivos a conservar (se borran los app-AAAA-MM-DD.log mas antiguos). */
  retentionDays: number;
  now?: () => Date;
  /** Para avisar (una sola vez) que no se pudo escribir; por defecto stderr. */
  onError?: (error: unknown) => void;
}

const FILE_PATTERN = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;
const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Fecha local (respeta la variable TZ del proceso) como AAAA-MM-DD. */
export function localDateStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Conserva `retentionDays` dias de logs contando hoy (con 14: hoy y los 13 anteriores) y borra el resto.
 * Solo toca archivos app-AAAA-MM-DD.log. Devuelve cuantos borro.
 */
export function pruneOldLogs(dir: string, retentionDays: number, today: Date): number {
  const limit = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - retentionDays * DAY_MS;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    const match = FILE_PATTERN.exec(name);
    if (match === null) continue;
    const fileDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (fileDay <= limit) {
      try {
        fs.unlinkSync(path.join(dir, name));
        removed += 1;
      } catch {
        // Si no se puede borrar ahora, se reintenta en la siguiente rotacion.
      }
    }
  }
  return removed;
}

/**
 * Escribe cada linea de log en <dir>/app-AAAA-MM-DD.log (un archivo por dia) y aplica la retencion al iniciar
 * y al cambiar de dia. Un fallo de escritura NUNCA interrumpe la aplicacion: se avisa una vez y se sigue.
 * Lanza solo si la carpeta no se puede crear/leer al inicio (el llamador decide continuar sin archivo).
 */
export function createFileLogSink(options: FileLogSinkOptions): LogSink {
  const now = options.now ?? ((): Date => new Date());
  const onError =
    options.onError ?? ((error: unknown): void => console.error(JSON.stringify({ level: 'error', message: 'No se pudo escribir el log en archivo', error: String(error) })));

  fs.mkdirSync(options.dir, { recursive: true });
  let currentDay = '';
  let currentFile = '';
  let reported = false;

  const rotate = (date: Date): void => {
    currentDay = localDateStamp(date);
    currentFile = path.join(options.dir, `app-${currentDay}.log`);
    pruneOldLogs(options.dir, options.retentionDays, date);
  };
  rotate(now());

  return {
    write(line: string): void {
      try {
        const date = now();
        if (localDateStamp(date) !== currentDay) rotate(date);
        fs.appendFileSync(currentFile, `${line}\n`, 'utf8');
        reported = false;
      } catch (error) {
        if (!reported) {
          reported = true;
          onError(error);
        }
      }
    },
  };
}
