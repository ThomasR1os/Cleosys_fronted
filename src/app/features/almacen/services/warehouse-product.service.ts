import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { WarehouseProduct } from '../models/almacen.models';

@Injectable({ providedIn: 'root' })
export class WarehouseProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/warehouse-products`;

  /** Sin filtro en servidor: filtrar por almacén en cliente si hace falta. */
  list(): Observable<WarehouseProduct[]> {
    return this.http.get<WarehouseProduct[]>(`${this.base}/`);
  }
}
