import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { WarehouseMovement } from '../models/almacen.models';

@Injectable({ providedIn: 'root' })
export class WarehouseMovementService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/warehouse-movements`;

  list(): Observable<WarehouseMovement[]> {
    return this.http.get<WarehouseMovement[]>(`${this.base}/`);
  }

  create(body: Partial<WarehouseMovement>): Observable<WarehouseMovement> {
    return this.http.post<WarehouseMovement>(`${this.base}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
