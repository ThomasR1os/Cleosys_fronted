import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { QuotationProductRow } from '../models/ventas.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

@Injectable({ providedIn: 'root' })
export class QuotationProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/quotation-products`;

  list(): Observable<QuotationProductRow[]> {
    return this.http.get<QuotationProductRow[]>(`${this.base}/`);
  }

  /** Líneas de una cotización. No usa el listado completo. */
  listByQuotation(quotationId: number): Observable<QuotationProductRow[]> {
    if (!Number.isInteger(quotationId) || quotationId <= 0) return of([]);
    const params = new HttpParams().set('quotation', String(quotationId));
    return this.http
      .get<QuotationProductRow[] | { results: QuotationProductRow[] }>(`${this.base}/`, { params })
      .pipe(map((res) => unwrapList(res).filter((line) => line.quotation === quotationId)));
  }

  create(body: Partial<QuotationProductRow>): Observable<QuotationProductRow> {
    return this.http.post<QuotationProductRow>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<QuotationProductRow>): Observable<QuotationProductRow> {
    return this.http.patch<QuotationProductRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
