import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, from, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { QUERY_STALE_MS, StaleCache } from '../../../core/utils/stale-cache';
import { resolveDrfNext } from '../../logistica/services/drf-list';
import { environment } from '../../../../environments/environment';
import type {
  ClientContactPayload,
  ClientCreatePayload,
  ClientLookupByRucResponse,
  ClientRow,
  SunatRucIdentificacion,
} from '../models/ventas.models';

const DROP_CLIENT_KEYS = new Set(['contacts', 'sales_summary', 'portfolio', 'company_client_detail']);

function slimClientRow(raw: unknown): ClientRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = Number(row['id']);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    ruc: String(row['ruc'] ?? ''),
    name: String(row['name'] ?? ''),
    address: row['address'] == null ? undefined : String(row['address']),
    is_mine: row['is_mine'] === true,
  };
}

function unwrapClientRows(res: unknown): ClientRow[] {
  const raw = Array.isArray(res)
    ? res
    : res && typeof res === 'object'
      ? ((res as { results?: unknown[] }).results ?? [])
      : [];
  const rows: ClientRow[] = [];
  for (const item of raw) {
    const slim = slimClientRow(item);
    if (slim) rows.push(slim);
  }
  return rows;
}

function foldClientText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function clientMatchesQuery(row: ClientRow, query: string): boolean {
  const tokens = foldClientText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = foldClientText(`${row.name} ${row.ruc} ${row.id}`);
  const compact = hay.replace(/[^a-z0-9]+/g, '');
  return tokens.every((token) => {
    const compactToken = token.replace(/[^a-z0-9]+/g, '');
    return hay.includes(token) || (!!compactToken && compact.includes(compactToken));
  });
}

function filterClientsByQuery(rows: ClientRow[], query: string): ClientRow[] {
  const q = foldClientText(query);
  return rows
    .filter((row) => clientMatchesQuery(row, query))
    .sort((a, b) => {
      const an = foldClientText(a.name);
      const bn = foldClientText(b.name);
      const ar = an.startsWith(q) ? 0 : an.split(/[^a-z0-9]+/).some((part) => part.startsWith(q)) ? 1 : 2;
      const br = bn.startsWith(q) ? 0 : bn.split(/[^a-z0-9]+/).some((part) => part.startsWith(q)) ? 1 : 2;
      if (ar !== br) return ar - br;
      return an.localeCompare(bn, 'es');
    })
    .slice(0, 30);
}

function parseClientListText(text: string): { rows: ClientRow[]; next: string | null } {
  const data = JSON.parse(text, (key, value) => (DROP_CLIENT_KEYS.has(key) ? undefined : value)) as unknown;
  const next =
    data && typeof data === 'object' && typeof (data as { next?: unknown }).next === 'string'
      ? String((data as { next: string }).next)
      : null;
  return { rows: unwrapClientRows(data), next };
}

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/clients`;
  private readonly sunatRucIdentificacion = `${environment.apiUrl}/sunat/ruc/identificacion`;
  private readonly companyListCache = new StaleCache<ClientRow[]>(QUERY_STALE_MS);
  private companyIndexInflight: Observable<ClientRow[]> | null = null;
  private companyIndexStop: (() => void) | null = null;

  /** Listado por defecto: "míos" (acotado por vendedor en el backend). */
  list(): Observable<ClientRow[]> {
    return this.http.get<ClientRow[]>(`${this.base}/`);
  }

  /**
   * Listado ampliado: todos los clientes de la empresa del usuario.
   * Lo usan `/ventas/clientes` y el formulario de proforma (`cache: true`, 2 minutos).
   * El backend valida pertenencia por empresa; editar y borrar siguen siendo "solo míos" o admin.
   */
  listForCompany(options?: { cache?: boolean }): Observable<ClientRow[]> {
    const request = () => {
      const params = new HttpParams().set('scope', 'company');
      return this.http.get<unknown>(`${this.base}/`, { params }).pipe(map(unwrapClientRows));
    };
    if (options?.cache) return this.companyListCache.read(request);
    return request().pipe(tap((rows) => this.companyListCache.write(rows)));
  }

  /** Índice liviano (id, ruc, name) de la empresa. Emite cada página acumulada. */
  prefetchCompanyList(): Observable<ClientRow[]> {
    const cached = this.companyListCache.fresh();
    if (cached) return of(cached);
    if (this.companyIndexInflight) return this.companyIndexInflight;

    const inflight = new Observable<ClientRow[]>((subscriber) => {
      let cancelled = false;
      let finished = false;
      const byId = new Map<number, ClientRow>();

      const finish = (): void => {
        if (finished) return;
        finished = true;
        const rows = [...byId.values()];
        if (rows.length) this.companyListCache.write(rows);
        subscriber.next(rows);
        subscriber.complete();
      };

      this.companyIndexStop = () => {
        cancelled = true;
        finish();
      };

      const load = (url: string, requestParams: HttpParams | undefined, page: number): void => {
        if (cancelled) return;
        if (page >= 25) {
          finish();
          return;
        }
        this.http
          .get(url, { params: requestParams, responseType: 'text' })
          .pipe(switchMap((text) => from(Promise.resolve(parseClientListText(text)))))
          .subscribe({
            next: (parsed) => {
              if (cancelled) return;
              for (const row of parsed.rows) byId.set(row.id, row);
              const rows = [...byId.values()];
              this.companyListCache.write(rows);
              subscriber.next(rows);
              const nextUrl = parsed.next ? resolveDrfNext(parsed.next) : null;
              if (nextUrl) load(nextUrl, undefined, page + 1);
              else finish();
            },
            error: (err) => subscriber.error(err),
          });
      };

      load(
        `${this.base}/`,
        new HttpParams().set('scope', 'company').set('page_size', '50').set('page', '1'),
        0,
      );
      return () => {
        cancelled = true;
      };
    }).pipe(
      finalize(() => {
        if (this.companyIndexInflight === inflight) {
          this.companyIndexInflight = null;
          this.companyIndexStop = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.companyIndexInflight = inflight;
    return inflight;
  }

  /** Corta el índice de empresa para no bloquear un alta o una consulta puntual. */
  cancelCompanyPrefetch(): void {
    const stop = this.companyIndexStop;
    this.companyIndexStop = null;
    this.companyIndexInflight = null;
    stop?.();
  }

  /**
   * RUC exacto → lookup-by-ruc.
   * Nombre → filtra el índice de empresa (no las primeras 20 del API).
   */
  searchCompany(query: string): Observable<ClientRow[]> {
    const q = query.trim();
    if (q.length < 2) return of([]);
    if (/^\d{8,11}$/.test(q)) {
      return this.lookupByRuc(q, 'company').pipe(
        map((res) => {
          const row = res.exists ? slimClientRow(res.client) : null;
          return row ? [row] : [];
        }),
      );
    }

    const cached = this.companyListCache.fresh();
    if (cached) return of(filterClientsByQuery(cached, q));
    return this.prefetchCompanyList().pipe(map((rows) => filterClientsByQuery(rows, q)));
  }

  /**
   * Cliente por RUC dentro de la empresa + resumen comercial y contactos (core).
   * `scope`: `company` (default) o `mine` según reglas del backend.
   */
  lookupByRuc(
    ruc: string,
    scope: 'company' | 'mine' = 'company',
  ): Observable<ClientLookupByRucResponse> {
    const params = new HttpParams().set('ruc', ruc.trim()).set('scope', scope);
    return this.http.get<ClientLookupByRucResponse>(`${this.base}/lookup-by-ruc/`, {
      params,
    });
  }

  retrieve(id: number): Observable<ClientRow> {
    return this.http.get<ClientRow>(`${this.base}/${id}/`);
  }

  /**
   * Alta de cliente + contacto inicial.
   * No enviar `user`/`owner` en `contact`: el serializer anidado de POST /clients/ no lo acepta
   * (400 «Expected pk value, received User»). El encargado se asigna con PATCH en client-contacts.
   */
  create(body: ClientCreatePayload & { id?: number }): Observable<ClientRow> {
    const contact: ClientContactPayload = {
      contact_first_name: body.contact.contact_first_name.trim(),
      contact_last_name: body.contact.contact_last_name.trim(),
    };
    const email = body.contact.email?.trim();
    const phone = body.contact.phone?.trim();
    if (email) contact.email = email;
    if (phone) contact.phone = phone;

    const payload: ClientCreatePayload & { id?: number } = {
      ruc: body.ruc.trim(),
      name: body.name.trim(),
      contact,
    };
    if (body.id != null) payload.id = body.id;
    this.cancelCompanyPrefetch();
    return this.http
      .post<ClientRow>(`${this.base}/`, payload)
      .pipe(tap((row) => this.mergeCompanyCache(row)));
  }

  update(id: number, body: Partial<Pick<ClientRow, 'ruc' | 'name'>>): Observable<ClientRow> {
    return this.http
      .patch<ClientRow>(`${this.base}/${id}/`, body)
      .pipe(tap((row) => this.mergeCompanyCache(row)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`).pipe(tap(() => this.removeCompanyCache(id)));
  }

  /** GET ?ruc= — respuesta con RUC y razón social desde SUNAT. */
  consultRucIdentificacion(ruc: string): Observable<SunatRucIdentificacion> {
    const trimmed = ruc.trim();
    return this.http.get<SunatRucIdentificacion>(`${this.sunatRucIdentificacion}/`, {
      params: { ruc: trimmed },
    });
  }

  private mergeCompanyCache(row: ClientRow): void {
    const slim = slimClientRow(row) ?? row;
    const data = this.companyListCache.fresh() ?? [];
    const next = data.some((item) => item.id === slim.id)
      ? data.map((item) => (item.id === slim.id ? { ...item, ...slim } : item))
      : [...data, slim];
    this.companyListCache.write(next);
  }

  private removeCompanyCache(id: number): void {
    const data = this.companyListCache.fresh();
    if (!data) {
      this.companyListCache.invalidate();
      return;
    }
    this.companyListCache.write(data.filter((item) => item.id !== id));
  }
}
