import { AppError } from '../utils/errors';

export interface RequestSchedulerOptions {
  /** Llamadas simultaneas maximas (0 = sin limite). */
  maxConcurrent: number;
  /** Llamadas maximas por ventana (0 = sin limite). */
  maxPerWindow: number;
  /** Tamano de la ventana en ms (60000 = por minuto). */
  windowMs?: number;
  /** Maximo que una llamada espera en cola antes de fallar con LLM_UNAVAILABLE. */
  queueMaxWaitMs: number;
  now?: () => number;
}

interface Job {
  start: () => void;
  reject: (error: AppError) => void;
  timer: NodeJS.Timeout;
}

/**
 * Cola FIFO con ritmo hacia Gemini: limita la concurrencia y las llamadas por ventana (ej. RPM de tu plan) para
 * no tocar la cuota. Solo ordena y retrasa; nunca descarta salvo que una llamada espere mas de queueMaxWaitMs.
 */
export class RequestScheduler {
  private active = 0;
  private starts: number[] = [];
  private readonly queue: Job[] = [];
  private wake: NodeJS.Timeout | null = null;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(private readonly options: RequestSchedulerOptions) {
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** true si no limita nada (se puede ejecutar directamente). */
  get disabled(): boolean {
    return this.options.maxConcurrent === 0 && this.options.maxPerWindow === 0;
  }

  get queued(): number {
    return this.queue.length;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.disabled) return task();
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        timer: setTimeout(() => {
          const index = this.queue.indexOf(job);
          if (index === -1) return;
          this.queue.splice(index, 1);
          reject(
            new AppError('LLM_UNAVAILABLE', 'El servicio de IA esta ocupado atendiendo otras conversaciones; intenta de nuevo en unos segundos', 503, {
              reason: 'queue-timeout',
              queueMaxWaitMs: this.options.queueMaxWaitMs,
              queued: this.queue.length,
            }),
          );
        }, this.options.queueMaxWaitMs),
        reject,
        start: () => {
          clearTimeout(job.timer);
          this.active += 1;
          this.starts.push(this.now());
          task().then(resolve, reject).finally(() => {
            this.active -= 1;
            this.pump();
          });
        },
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    const { maxConcurrent, maxPerWindow } = this.options;
    const current = this.now();
    this.starts = this.starts.filter((at) => current - at < this.windowMs);

    while (this.queue.length > 0) {
      if (maxConcurrent > 0 && this.active >= maxConcurrent) return; // se reanuda cuando termine una llamada activa
      if (maxPerWindow > 0 && this.starts.length >= maxPerWindow) {
        this.scheduleWake(current);
        return;
      }
      this.queue.shift()?.start();
    }
  }

  private scheduleWake(current: number): void {
    if (this.wake !== null) return;
    const oldest = this.starts[0] ?? current;
    const delay = Math.max(1, oldest + this.windowMs - current);
    this.wake = setTimeout(() => {
      this.wake = null;
      this.pump();
    }, delay);
  }
}
