import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ProductSupplierRow } from '../models/logistica.models';

/**
 * API bajo `/api/almacen/` con AlmacenWritePermission en escritura
 * (rol Almacén o Admin), aunque la pantalla viva en el módulo Logística.
 */
@Injectable({ providedIn: 'root' })
export class ProductSupplierService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/product-suppliers`;

  list(): Observable<ProductSupplierRow[]> {
    return this.http.get<ProductSupplierRow[]>(`${this.base}/`);
  }

  create(body: Partial<ProductSupplierRow>): Observable<ProductSupplierRow> {
    return this.http.post<ProductSupplierRow>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<ProductSupplierRow>): Observable<ProductSupplierRow> {
    return this.http.patch<ProductSupplierRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
