/** Cache en memoria con TTL para descartar reintentos duplicados de webhooks. */
export class SeenCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Devuelve true si la clave ya se habia visto; si no, la registra y devuelve false. */
  seen(key: string): boolean {
    const current = this.now();
    const previous = this.entries.get(key);
    if (previous !== undefined && current - previous <= this.ttlMs) return true;

    this.entries.delete(key);
    this.entries.set(key, current);
    if (this.entries.size > this.maxEntries) {
      for (const [k, at] of this.entries) {
        if (current - at > this.ttlMs || this.entries.size > this.maxEntries) this.entries.delete(k);
        else break;
      }
    }
    return false;
  }
}
