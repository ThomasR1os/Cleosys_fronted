import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  MovementType,
  WarehouseMovement,
  WarehouseMovementImportResult,
  WarehouseMovementWrite,
} from '../models/almacen.models';

function normalizeMovement(row: Record<string, unknown>): WarehouseMovement {
  const type = String(row['movement_type'] ?? '').toUpperCase();
  const movement_type: MovementType = type === 'SALIDA' ? 'SALIDA' : 'ENTRADA';
  const observation = row['observation'];
  return {
    id: Number(row['id']),
    warehouse: Number(row['warehouse']),
    product: Number(row['product']),
    cant: row['cant'] == null ? '' : String(row['cant']),
    movement_type,
    observation:
      observation == null || String(observation).trim() === '' ? null : String(observation),
    creation_date: row['creation_date'] != null ? String(row['creation_date']) : undefined,
  };
}

export function normalizeImportResult(raw: Record<string, unknown>): WarehouseMovementImportResult {
  const errorsRaw = Array.isArray(raw['errors']) ? raw['errors'] : [];
  return {
    created: Number(raw['created'] ?? 0),
    failed: Number(raw['failed'] ?? 0),
    errors: errorsRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        row: Number(row['row'] ?? 0),
        error: String(row['error'] ?? 'Error'),
      };
    }),
  };
}

@Injectable({ providedIn: 'root' })
export class WarehouseMovementService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/warehouse-movements`;

  list(): Observable<WarehouseMovement[]> {
    return this.http.get<unknown[]>(`${this.base}/`).pipe(
      map((rows) => (rows as Record<string, unknown>[]).map((row) => normalizeMovement(row))),
    );
  }

  create(body: WarehouseMovementWrite): Observable<WarehouseMovement> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, body)
      .pipe(map((row) => normalizeMovement(row)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /** POST multipart `file` (.xlsx) → /import-excel/. Si falla una fila, no se guarda ninguna. */
  importExcel(file: File): Observable<WarehouseMovementImportResult> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http
      .post<Record<string, unknown>>(`${this.base}/import-excel/`, fd)
      .pipe(map((raw) => normalizeImportResult(raw)));
  }
}
