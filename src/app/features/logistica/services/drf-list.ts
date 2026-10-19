import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

const MAX_PAGES = 25;

/** Sigue `next` de DRF y reescribe la URL para el proxy (`/api`) o el host de producción. */
export function fetchDrfList(
  http: HttpClient,
  url: string,
  params?: HttpParams,
  page = 0,
): Observable<Record<string, unknown>[]> {
  if (page >= MAX_PAGES) return of([]);
  return http.get<unknown>(url, params ? { params } : {}).pipe(
    switchMap((res) => {
      if (Array.isArray(res)) return of(res as Record<string, unknown>[]);
      if (!res || typeof res !== 'object') return of([]);
      const body = res as { results?: unknown; next?: unknown };
      const rows = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
      const next = typeof body.next === 'string' ? resolveDrfNext(body.next) : null;
      if (!next) return of(rows);
      return fetchDrfList(http, next, undefined, page + 1).pipe(map((more) => [...rows, ...more]));
    }),
  );
}

/** Emite cada página acumulada para pintar la UI sin esperar el listado completo. */
export function fetchDrfListIncremental(
  http: HttpClient,
  url: string,
  params?: HttpParams,
): Observable<{ rows: Record<string, unknown>[]; done: boolean }> {
  return new Observable((subscriber) => {
    let cancelled = false;
    const acc: Record<string, unknown>[] = [];

    const load = (nextUrl: string, nextParams: HttpParams | undefined, page: number): void => {
      if (cancelled) return;
      if (page >= MAX_PAGES) {
        subscriber.next({ rows: acc, done: true });
        subscriber.complete();
        return;
      }
      http.get<unknown>(nextUrl, nextParams ? { params: nextParams } : {}).subscribe({
        next: (res) => {
          if (cancelled) return;
          if (Array.isArray(res)) {
            subscriber.next({ rows: res as Record<string, unknown>[], done: true });
            subscriber.complete();
            return;
          }
          if (!res || typeof res !== 'object') {
            subscriber.next({ rows: acc, done: true });
            subscriber.complete();
            return;
          }
          const body = res as { results?: unknown; next?: unknown };
          const batch = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
          acc.push(...batch);
          const next = typeof body.next === 'string' ? resolveDrfNext(body.next) : null;
          subscriber.next({ rows: [...acc], done: !next });
          if (next) load(next, undefined, page + 1);
          else subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });
    };

    load(url, params, 0);
    return () => {
      cancelled = true;
    };
  });
}

export function resolveDrfNext(next: string): string | null {
  const apiUrl = environment.apiUrl.replace(/\/$/, '');
  if (next.startsWith('/')) {
    if (!apiUrl.startsWith('http')) return next;
    const idx = next.indexOf('/api/');
    if (idx < 0) return null;
    return `${apiUrl}${next.slice(idx + '/api'.length)}`;
  }
  try {
    const url = new URL(next);
    const idx = url.pathname.indexOf('/api/');
    if (idx < 0) return next;
    const suffix = url.pathname.slice(idx + '/api'.length) + url.search;
    if (apiUrl.startsWith('http')) return `${apiUrl}${suffix}`;
    return `/api${suffix}`;
  } catch {
    return null;
  }
}
