import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  normalizePurchaseOrderItem,
  type PurchaseOrderItem,
  type PurchaseOrderItemWrite,
} from '../models/purchase-order.models';
import { fetchDrfList } from './drf-list';

/**
 * Líneas de una orden. Alta, cambio o baja hacen que el servidor recalcule los totales.
 * `received_qty` nace en 0 y no puede superar `cant`.
 */
@Injectable({ providedIn: 'root' })
export class PurchaseOrderItemService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/compras/purchase-order-items`;

  list(purchaseOrderId: number): Observable<PurchaseOrderItem[]> {
    const params = new HttpParams()
      .set('purchase_order', String(purchaseOrderId))
      .set('page_size', '200');
    return fetchDrfList(this.http, `${this.base}/`, params).pipe(
      map((rows) =>
        rows
          .map((row) => normalizePurchaseOrderItem(row, purchaseOrderId))
          .sort((a, b) => a.id - b.id),
      ),
    );
  }

  create(body: PurchaseOrderItemWrite): Observable<PurchaseOrderItem> {
    return this.http
      .post<unknown>(`${this.base}/`, body)
      .pipe(map((row) => normalizePurchaseOrderItem(row, body.purchase_order)));
  }

  update(
    id: number,
    body: Partial<PurchaseOrderItemWrite>,
  ): Observable<PurchaseOrderItem> {
    return this.http
      .patch<unknown>(`${this.base}/${id}/`, body)
      .pipe(map((row) => normalizePurchaseOrderItem(row, body.purchase_order ?? 0)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
