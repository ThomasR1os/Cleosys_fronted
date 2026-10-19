import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import { QUERY_STALE_MS, StaleCache } from '../../../core/utils/stale-cache';
import { environment } from '../../../../environments/environment';
import type {
  QuotationRow,
  QuotationSendEmailRequest,
  QuotationSendEmailResponse,
  QuotationSummary,
} from '../models/ventas.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

/** Id entero positivo. Vacío, 0 o decimal no se envían como query (el API responde 400). */
function positiveId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

/** Cliente HTTP: `GET|POST …/api/ventas/quotations/`, `GET|PATCH|PUT|DELETE …/quotations/{id}/`. */
@Injectable({ providedIn: 'root' })
export class QuotationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/quotations`;
  private readonly summaryByClient = new Map<number, StaleCache<QuotationSummary[]>>();

  list(): Observable<QuotationRow[]> {
    return this.http.get<QuotationRow[]>(`${this.base}/`);
  }

  /**
   * Selector de proforma: solo las cotizaciones del cliente.
   * `GET /api/ventas/quotations/?client=<id>&summary=1`
   * Si `client` no es un entero, no se llama al API.
   */
  listSummaryByClient(clientId: number): Observable<QuotationSummary[]> {
    const id = positiveId(clientId);
    if (id == null) return of([]);
    let cache = this.summaryByClient.get(id);
    if (!cache) {
      cache = new StaleCache<QuotationSummary[]>(QUERY_STALE_MS);
      this.summaryByClient.set(id, cache);
    }
    return cache.read(() => {
      const params = new HttpParams().set('client', String(id)).set('summary', '1');
      return this.http
        .get<QuotationSummary[] | { results: QuotationSummary[] }>(`${this.base}/`, { params })
        .pipe(
          map((res) => unwrapList(res).filter((row) => positiveId(row.client) === id)),
        );
    });
  }

  retrieve(id: number): Observable<QuotationRow> {
    return this.http.get<QuotationRow>(`${this.base}/${id}/`);
  }

  create(body: Partial<QuotationRow> & Record<string, unknown>): Observable<QuotationRow> {
    return this.http
      .post<QuotationRow>(`${this.base}/`, body)
      .pipe(tap(() => this.invalidateSummaries()));
  }

  update(id: number, body: Partial<QuotationRow>): Observable<QuotationRow> {
    return this.http
      .patch<QuotationRow>(`${this.base}/${id}/`, body)
      .pipe(tap(() => this.invalidateSummaries()));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`).pipe(tap(() => this.invalidateSummaries()));
  }

  /** POST /api/ventas/quotations/{id}/send-email/ — PDF en base64 + destinatarios. */
  sendEmail(id: number, body: QuotationSendEmailRequest): Observable<QuotationSendEmailResponse> {
    return this.http.post<QuotationSendEmailResponse>(`${this.base}/${id}/send-email/`, body);
  }

  private invalidateSummaries(): void {
    for (const cache of this.summaryByClient.values()) cache.invalidate();
  }
}
