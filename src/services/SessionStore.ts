import type { Channel, PCBuildState } from '../types/domain';
import type { LlmMessage } from '../types/llm';
import { createEmptyBuild } from './PCBuildEngine';

export interface CustomerInfo {
  name?: string;
  phone?: string;
}

/** Estado en memoria de una conversacion: historial del LLM + carrito de armado de PC. */
export interface Session {
  key: string;
  channel: Channel;
  createdAt: number;
  lastActiveAt: number;
  history: LlmMessage[];
  build: PCBuildState;
  customer: CustomerInfo;
}

export interface SessionStoreOptions {
  ttlMs: number;
  maxSessions: number;
}

/** Almacen de sesiones en memoria con expiracion (TTL), tope de capacidad y exclusion por sesion. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly locks = new Map<string, Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: SessionStoreOptions,
    private readonly now: () => number = Date.now,
  ) {}

  getOrCreate(key: string, channel: Channel): Session {
    const existing = this.sessions.get(key);
    if (existing !== undefined && this.now() - existing.lastActiveAt <= this.options.ttlMs) {
      existing.lastActiveAt = this.now();
      // Reinsertar mantiene el orden de uso reciente para el desalojo.
      this.sessions.delete(key);
      this.sessions.set(key, existing);
      return existing;
    }

    const timestamp = this.now();
    const session: Session = {
      key,
      channel,
      createdAt: timestamp,
      lastActiveAt: timestamp,
      history: [],
      build: createEmptyBuild(new Date(timestamp)),
      customer: {},
    };
    this.sessions.set(key, session);

    while (this.sessions.size > this.options.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done === true) break;
      this.sessions.delete(oldest.value);
    }
    return session;
  }

  peek(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  size(): number {
    return this.sessions.size;
  }

  delete(key: string): boolean {
    return this.sessions.delete(key);
  }

  /** Elimina sesiones vencidas. Devuelve cuantas elimino. */
  sweep(): number {
    const limit = this.now() - this.options.ttlMs;
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.lastActiveAt < limit) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper !== null) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Serializa el procesamiento de mensajes de una misma sesion para no corromper su estado. */
  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
