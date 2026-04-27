import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { WarehouseProduct } from '../models/almacen.models';

function normalizeWarehouseProduct(row: Record<string, unknown>): WarehouseProduct {
  return {
    id: Number(row['id']),
    warehouse: Number(row['warehouse']),
    product: Number(row['product']),
    stock: Number(row['stock'] ?? 0),
    location: String(row['location'] ?? row['ubication'] ?? ''),
    creation_date: row['creation_date'] != null ? String(row['creation_date']) : undefined,
  };
}

@Injectable({ providedIn: 'root' })
export class WarehouseProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/warehouse-products`;

  /** Sin filtro en servidor: filtrar por almacén en cliente si hace falta. */
  list(): Observable<WarehouseProduct[]> {
    return this.http.get<unknown[]>(`${this.base}/`).pipe(
      map((rows) => (rows as Record<string, unknown>[]).map((r) => normalizeWarehouseProduct(r))),
    );
  }
}
