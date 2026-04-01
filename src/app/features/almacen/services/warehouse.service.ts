import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Warehouse } from '../models/almacen.models';

@Injectable({ providedIn: 'root' })
export class WarehouseService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/warehouses`;

  list(): Observable<Warehouse[]> {
    return this.http.get<Warehouse[]>(`${this.base}/`);
  }

  retrieve(id: number): Observable<Warehouse> {
    return this.http.get<Warehouse>(`${this.base}/${id}/`);
  }

  create(body: Partial<Warehouse>): Observable<Warehouse> {
    return this.http.post<Warehouse>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<Warehouse>): Observable<Warehouse> {
    return this.http.patch<Warehouse>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
