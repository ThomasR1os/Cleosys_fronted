import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  normalizeLogisticsOrderItem,
  type LogisticsOrderItem,
} from '../models/logistics-order.models';
import { fetchDrfList } from './drf-list';

/** Líneas de una orden interna. `pending_qty` es lo que todavía falta comprar. */
@Injectable({ providedIn: 'root' })
export class LogisticsOrderItemService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/logistica/logistics-order-items`;

  list(logisticsOrderId: number): Observable<LogisticsOrderItem[]> {
    const params = new HttpParams()
      .set('logistics_order', String(logisticsOrderId))
      .set('page_size', '200');
    return fetchDrfList(this.http, `${this.base}/`, params).pipe(
      map((rows) =>
        rows
          .map((row) => normalizeLogisticsOrderItem(row, logisticsOrderId))
          .filter((row) => row.id > 0)
          .sort((a, b) => a.id - b.id),
      ),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
