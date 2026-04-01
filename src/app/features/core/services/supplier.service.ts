import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Supplier, SupplierType } from '../models/supplier.model';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : res.results;
}

function normalizeSupplierType(raw: unknown): SupplierType {
  if (raw === 'NACIONAL' || raw === 'EXTRANJERO') return raw;
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    if (u === 'NACIONAL' || u === 'EXTRANJERO') return u;
  }
  return 'NACIONAL';
}

/** Acepta JSON del serializer Django (`address` o `adress`, `bank_accounts` texto o lista). */
function normalizeSupplier(row: Record<string, unknown>): Supplier {
  const addr = row['adress'] ?? row['address'];
  let bank = row['bank_accounts'];
  if (Array.isArray(bank)) {
    bank = bank.map(String).join('\n');
  }
  return {
    id: Number(row['id']),
    type: normalizeSupplierType(row['type']),
    ruc: String(row['ruc'] ?? ''),
    name: String(row['name'] ?? ''),
    adress: String(addr ?? ''),
    contact: String(row['contact'] ?? ''),
    email: String(row['email'] ?? ''),
    phone: String(row['phone'] ?? ''),
    bank_accounts: String(bank ?? ''),
  };
}

/** Envía ambas claves de dirección por si el modelo usa `address` o `adress`. */
function toApiPayload(body: Partial<Supplier>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  if ('adress' in out) {
    const a = out['adress'];
    out['address'] = a;
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/suppliers`;

  list(): Observable<Supplier[]> {
    return this.http
      .get<Record<string, unknown>[] | { results: Record<string, unknown>[] }>(`${this.base}/`)
      .pipe(
        map((res) => unwrapList(res)),
        map((rows) => rows.map((r) => normalizeSupplier(r))),
      );
  }

  retrieve(id: number): Observable<Supplier> {
    return this.http
      .get<Record<string, unknown>>(`${this.base}/${id}/`)
      .pipe(map((r) => normalizeSupplier(r)));
  }

  create(body: Partial<Supplier>): Observable<Supplier> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, toApiPayload(body))
      .pipe(map((r) => normalizeSupplier(r)));
  }

  update(id: number, body: Partial<Supplier>): Observable<Supplier> {
    return this.http
      .patch<Record<string, unknown>>(`${this.base}/${id}/`, toApiPayload(body))
      .pipe(map((r) => normalizeSupplier(r)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
