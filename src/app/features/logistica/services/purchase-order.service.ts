import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  normalizePurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderCreate,
  type PurchaseOrderListQuery,
  type PurchaseOrderWrite,
} from '../models/purchase-order.models';
import { fetchDrfList } from './drf-list';

/**
 * Órdenes de compra de la empresa del usuario autenticado.
 * `items` solo se persisten en el POST de alta. Un PATCH de cabecera no toca las líneas.
 */
@Injectable({ providedIn: 'root' })
export class PurchaseOrderService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/compras/purchase-orders`;

  list(query: PurchaseOrderListQuery = {}): Observable<PurchaseOrder[]> {
    let params = new HttpParams().set('page_size', '200');
    if (query.supplier != null && query.supplier > 0) {
      params = params.set('supplier', String(query.supplier));
    }
    if (query.status) params = params.set('status', query.status);
    const correlativo = query.correlativo?.trim();
    if (correlativo) params = params.set('correlativo', correlativo);
    return fetchDrfList(this.http, `${this.base}/`, params).pipe(
      map((rows) =>
        rows
          .map((row) => normalizePurchaseOrder(row))
          .sort((a, b) => b.id - a.id),
      ),
    );
  }

  retrieve(id: number): Observable<PurchaseOrder> {
    return this.http
      .get<unknown>(`${this.base}/${id}/`)
      .pipe(map((row) => normalizePurchaseOrder(row)));
  }

  create(body: PurchaseOrderCreate): Observable<PurchaseOrder> {
    return this.http
      .post<unknown>(`${this.base}/`, body)
      .pipe(map((row) => normalizePurchaseOrder(row)));
  }

  update(id: number, body: PurchaseOrderWrite): Observable<PurchaseOrder> {
    return this.http
      .patch<unknown>(`${this.base}/${id}/`, body)
      .pipe(map((row) => normalizePurchaseOrder(row)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
