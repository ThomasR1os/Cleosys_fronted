import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Product } from '../models/almacen.models';

function fkId(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'object' && v !== null && 'id' in v) {
    const n = Number((v as { id: unknown }).id);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function optStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

function optDecimal(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isNaN(n) ? null : n;
}

function nestedCategoryIdFromSubcategory(subRaw: unknown): number | null {
  if (subRaw == null || typeof subRaw !== 'object') return null;
  const o = subRaw as Record<string, unknown>;
  return fkId(o['category'] ?? o['category_id']);
}

function normalizeProduct(row: Record<string, unknown>): Product {
  const warrantyRaw =
    row['warrannty'] ?? row['warranty'] ?? row['warranty_months'];

  const subRaw = row['subcategory'] ?? row['subcategory_id'];
  const subcategory = fkId(subRaw);
  const categoryFromSub = nestedCategoryIdFromSubcategory(subRaw);

  return {
    id: Number(row['id']),
    sku: String(row['sku'] ?? ''),
    description: String(row['description'] ?? ''),
    category: fkId(row['category'] ?? row['category_id']) ?? categoryFromSub,
    subcategory,
    type: fkId(row['type'] ?? row['type_id']),
    brand: fkId(row['brand'] ?? row['brand_id']),
    unit_measurement: fkId(row['unit_measurement'] ?? row['unit_measurement_id']),
    datasheet: optStr(row['datasheet']),
    price: optDecimal(row['price']),
    rental_price_without_operator: optDecimal(row['rental_price_without_operator']),
    rental_price_with_operator: optDecimal(row['rental_price_with_operator']),
    warrannty: optStr(warrantyRaw),
    status: optStr(row['status']) ?? 'ACTIVE',
    dimensions: optStr(row['dimensions']),
    gross_weight: optStr(row['gross_weight']),
  };
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/products`;

  list(): Observable<Product[]> {
    return this.http.get<unknown[]>(`${this.base}/`).pipe(
      map((rows) => (rows as Record<string, unknown>[]).map((r) => normalizeProduct(r))),
    );
  }

  get(id: number): Observable<Product> {
    return this.http.get<Record<string, unknown>>(`${this.base}/${id}/`).pipe(
      map((r) => normalizeProduct(r)),
    );
  }

  create(body: Partial<Product>): Observable<Product> {
    return this.http.post<Record<string, unknown>>(`${this.base}/`, body).pipe(
      map((r) => normalizeProduct(r)),
    );
  }

  update(id: number, body: Partial<Product>): Observable<Product> {
    return this.http.patch<Record<string, unknown>>(`${this.base}/${id}/`, body).pipe(
      map((r) => normalizeProduct(r)),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
