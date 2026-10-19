import { Observable, finalize, of, share, tap } from 'rxjs';

/** Ventana en la que un GET ya hecho se reutiliza al volver a la ruta. */
export const QUERY_STALE_MS = 120_000;

/**
 * Caché en memoria con staleTime. Varias vistas comparten el mismo GET en vuelo
 * y, si el usuario sale antes de que termine, la respuesta igual queda guardada.
 */
export class StaleCache<T> {
  private entry: { at: number; data: T } | null = null;
  private inflight: Observable<T> | null = null;
  private generation = 0;

  constructor(private readonly staleMs: number) {}

  fresh(): T | undefined {
    if (!this.entry) return undefined;
    if (Date.now() - this.entry.at >= this.staleMs) return undefined;
    return this.entry.data;
  }

  read(source: () => Observable<T>): Observable<T> {
    const hit = this.fresh();
    if (hit !== undefined) return of(hit);
    if (this.inflight) return this.inflight;

    const generation = this.generation;
    const shared = source().pipe(
      tap((data) => {
        if (generation !== this.generation) return;
        this.entry = { at: Date.now(), data };
      }),
      finalize(() => {
        if (this.inflight === shared) this.inflight = null;
      }),
      share(),
    );
    this.inflight = shared;
    shared.subscribe({ error: () => undefined });
    return shared;
  }

  write(data: T): void {
    this.generation++;
    this.entry = { at: Date.now(), data };
  }

  invalidate(): void {
    this.generation++;
    this.entry = null;
    this.inflight = null;
  }
}
