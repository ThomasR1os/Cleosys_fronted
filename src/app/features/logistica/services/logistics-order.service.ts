import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  normalizeLogisticsOrder,
  type LogisticsOrder,
  type LogisticsOrderListQuery,
  type LogisticsOrderPatch,
} from '../models/logistics-order.models';
import { fetchDrfList } from './drf-list';

/**
 * Órdenes internas de compra. Nacen al aprobar una cotización; no hay POST.
 * El PATCH solo acepta `status` y `notes` (rol Logística o Admin).
 */
@Injectable({ providedIn: 'root' })
export class LogisticsOrderService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/logistica/logistics-orders`;

  list(query: LogisticsOrderListQuery = {}): Observable<LogisticsOrder[]> {
    let params = new HttpParams().set('page_size', '200');
    if (query.status) params = params.set('status', query.status);
    if (query.quotation != null && query.quotation > 0) {
      params = params.set('quotation', String(query.quotation));
    }
    if (query.client != null && query.client > 0) {
      params = params.set('client', String(query.client));
    }
    return fetchDrfList(this.http, `${this.base}/`, params).pipe(
      map((rows) =>
        rows
          .map((row) => normalizeLogisticsOrder(row))
          .filter((row) => row.id > 0)
          .sort((a, b) => b.id - a.id),
      ),
    );
  }

  retrieve(id: number): Observable<LogisticsOrder> {
    return this.http
      .get<unknown>(`${this.base}/${id}/`)
      .pipe(map((row) => normalizeLogisticsOrder(row)));
  }

  update(id: number, body: LogisticsOrderPatch): Observable<LogisticsOrder> {
    return this.http
      .patch<unknown>(`${this.base}/${id}/`, { status: body.status, notes: body.notes })
      .pipe(map((row) => normalizeLogisticsOrder(row)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
