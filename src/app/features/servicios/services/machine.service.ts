import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  Machine,
  MachineListFilters,
  MachineWritePayload,
} from '../models/servicios.models';

function fkId(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof v === 'object' && v !== null && 'id' in v) {
    const n = Number((v as { id: unknown }).id);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function nestedName(v: unknown): string | null {
  if (v == null || typeof v !== 'object') return null;
  if (!('name' in v)) return null;
  const n = String((v as { name: unknown }).name ?? '').trim();
  return n || null;
}

function optStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

function optNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isNaN(n) ? null : n;
}

function normalizeMachine(row: Record<string, unknown>): Machine {
  const clientRaw = row['client'] ?? row['client_id'];
  const brandRaw = row['brand'] ?? row['brand_id'];
  return {
    id: Number(row['id']),
    company: fkId(row['company'] ?? row['company_id']),
    client: fkId(clientRaw) ?? 0,
    client_name: optStr(row['client_name']) ?? nestedName(clientRaw),
    brand: fkId(brandRaw) ?? 0,
    brand_name: optStr(row['brand_name']) ?? nestedName(brandRaw),
    model: String(row['model'] ?? ''),
    serial_number: String(row['serial_number'] ?? ''),
    plate_image_url: optStr(row['plate_image_url']),
    daily_working_hours: optNum(row['daily_working_hours']) ?? 0,
    current_hour_meter: optNum(row['current_hour_meter']),
    location: String(row['location'] ?? ''),
    status: optStr(row['status']) ?? 'ACTIVE',
    created_at: optStr(row['created_at']),
    updated_at: optStr(row['updated_at']),
  };
}

function unwrapList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object' && 'results' in raw) {
    const results = (raw as { results: unknown }).results;
    if (Array.isArray(results)) return results as Record<string, unknown>[];
  }
  return [];
}

@Injectable({ providedIn: 'root' })
export class MachineService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/servicios/machines`;

  list(filters?: MachineListFilters): Observable<Machine[]> {
    let params = new HttpParams();
    if (filters?.client_id != null) {
      params = params.set('client_id', String(filters.client_id));
    }
    if (filters?.brand_id != null) {
      params = params.set('brand_id', String(filters.brand_id));
    }
    if (filters?.status?.trim()) {
      params = params.set('status', filters.status.trim());
    }
    return this.http.get<unknown>(`${this.base}/`, { params }).pipe(
      map((raw) => unwrapList(raw).map((r) => normalizeMachine(r))),
    );
  }

  get(id: number): Observable<Machine> {
    return this.http
      .get<Record<string, unknown>>(`${this.base}/${id}/`)
      .pipe(map((r) => normalizeMachine(r)));
  }

  create(body: MachineWritePayload): Observable<Machine> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, body)
      .pipe(map((r) => normalizeMachine(r)));
  }

  update(id: number, body: Partial<MachineWritePayload>): Observable<Machine> {
    return this.http
      .patch<Record<string, unknown>>(`${this.base}/${id}/`, body)
      .pipe(map((r) => normalizeMachine(r)));
  }

  /**
   * Sube la imagen de placa a Cloudinary vía backend y actualiza `plate_image_url`.
   * POST /api/servicios/machines/{id}/upload_plate/ — multipart `file`.
   */
  uploadPlate(id: number, file: File): Observable<Machine> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http
      .post<Record<string, unknown>>(`${this.base}/${id}/upload_plate/`, fd)
      .pipe(map((r) => normalizeMachine(r)));
  }

  createWithOptionalPlate(
    body: MachineWritePayload,
    plateFile: File | null,
  ): Observable<Machine> {
    const { plate_image_url: _ignored, ...rest } = body;
    return this.create(rest).pipe(
      switchMap((m) => (plateFile ? this.uploadPlate(m.id, plateFile) : of(m))),
    );
  }

  updateWithOptionalPlate(
    id: number,
    body: Partial<MachineWritePayload>,
    plateFile: File | null,
  ): Observable<Machine> {
    const { plate_image_url: _ignored, ...rest } = body;
    return this.update(id, rest).pipe(
      switchMap((m) => (plateFile ? this.uploadPlate(id, plateFile) : of(m))),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
