import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { QUERY_STALE_MS, StaleCache } from '../../../core/utils/stale-cache';
import { environment } from '../../../../environments/environment';
import type { Product } from '../models/almacen.models';

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

function optDecimal(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isNaN(n) ? null : n;
}

/** Entero ≥ 0. Vacío o ausente es null. 0 se conserva (entrega inmediata). */
function optLeadDays(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0 || n !== Math.trunc(n)) return null;
  return n;
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
  const catRaw = row['category'] ?? row['category_id'];
  const subcategory = fkId(subRaw);
  const categoryFromSub = nestedCategoryIdFromSubcategory(subRaw);
  const category = fkId(catRaw) ?? categoryFromSub;
  /** Nombre embebido si el API anida `{ id, name }` (fallback de UI). */
  const category_name = nestedName(catRaw) ?? nestedName(
    typeof subRaw === 'object' && subRaw !== null
      ? (subRaw as Record<string, unknown>)['category']
      : null,
  );

  return {
    id: Number(row['id']),
    sku: String(row['sku'] ?? ''),
    description: String(row['description'] ?? ''),
    category,
    category_name,
    subcategory,
    type: fkId(row['type'] ?? row['type_id']),
    brand: fkId(row['brand'] ?? row['brand_id']),
    unit_measurement: fkId(row['unit_measurement'] ?? row['unit_measurement_id']),
    datasheet: optStr(row['datasheet']),
    price: optDecimal(row['price']),
    rental_price_without_operator: optDecimal(row['rental_price_without_operator']),
    rental_price_with_operator: optDecimal(row['rental_price_with_operator']),
    warranty: optStr(warrantyRaw),
    estimated_lead_time_days: optLeadDays(row['estimated_lead_time_days']),
    /** Compat: solo si la API lo envía con el typo. */
    warrannty: optStr(row['warrannty']),
    status: optStr(row['status']) ?? 'ACTIVE',
    dimensions: optStr(row['dimensions']),
    gross_weight: optStr(row['gross_weight']),
    creation_date: optStr(row['creation_date']),
    update_date: optStr(row['update_date']),
  };
}

type WarrantyFieldVariant = 'warranty' | 'warrannty';

function toApiPayload(body: Partial<Product>, variant: WarrantyFieldVariant): Record<string, unknown> {
  const b = body as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...b };

  const w = (b['warranty'] ?? b['warrannty']) as unknown;
  delete payload['warranty'];
  delete payload['warrannty'];
  delete payload['category_name'];
  payload[variant] = w;

  return payload;
}

function isWarrantyFieldError(err: unknown): boolean {
  const e = err as { status?: unknown; error?: unknown; message?: unknown };
  if (e?.status !== 400) return false;
  const blob = String(e?.message ?? '') + ' ' + String(e?.error ?? '');
  return blob.toLowerCase().includes('warran');
}

export type ProductBulkUpsertRequest = {
  mode: 'upsert';
  partial_update: boolean;
  items: Record<string, unknown>[];
};

export type ProductBulkUpsertError = {
  index: number;
  sku: string;
  message: string;
};

export type ProductBulkUpsertResponse = {
  created: number;
  updated: number;
  failed: number;
  errors: ProductBulkUpsertError[];
};

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/products`;
  private readonly listCache = new StaleCache<Product[]>(QUERY_STALE_MS);

  list(): Observable<Product[]> {
    return this.listCache.read(() =>
      this.http.get<unknown>(`${this.base}/`).pipe(map((body) => readProducts(body).rows)),
    );
  }

  /**
   * Hasta 20 coincidencias. Si el API ignora `search` y devuelve el catálogo entero,
   * se guarda una vez y las siguientes búsquedas salen de esa caché.
   */
  search(query: string): Observable<Product[]> {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return of([]);
    const cached = this.listCache.fresh();
    if (cached) return of(matchProducts(cached, text).slice(0, 20));
    const params = new HttpParams().set('search', query.trim()).set('page_size', '20');
    return this.http.get<unknown>(`${this.base}/`, { params }).pipe(
      map((body) => {
        const page = readProducts(body);
        if (!page.bounded && page.rows.length > 40) this.listCache.write(page.rows);
        return matchProducts(page.rows, text).slice(0, 20);
      }),
    );
  }

  get(id: number): Observable<Product> {
    return this.http.get<Record<string, unknown>>(`${this.base}/${id}/`).pipe(
      map((r) => normalizeProduct(r)),
    );
  }

  create(body: Partial<Product>): Observable<Product> {
    const preferred: WarrantyFieldVariant = 'warranty';
    const fallback: WarrantyFieldVariant = 'warrannty';
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, toApiPayload(body, preferred))
      .pipe(
        catchError((err) => {
          if (!isWarrantyFieldError(err)) return throwError(() => err);
          return this.http.post<Record<string, unknown>>(`${this.base}/`, toApiPayload(body, fallback));
        }),
        map((r) => normalizeProduct(r)),
        tap(() => this.listCache.invalidate()),
      );
  }

  update(id: number, body: Partial<Product>): Observable<Product> {
    const preferred: WarrantyFieldVariant = 'warranty';
    const fallback: WarrantyFieldVariant = 'warrannty';
    return this.http
      .patch<Record<string, unknown>>(`${this.base}/${id}/`, toApiPayload(body, preferred))
      .pipe(
        catchError((err) => {
          if (!isWarrantyFieldError(err)) return throwError(() => err);
          return this.http.patch<Record<string, unknown>>(`${this.base}/${id}/`, toApiPayload(body, fallback));
        }),
        map((r) => normalizeProduct(r)),
        tap(() => this.listCache.invalidate()),
      );
  }

  /** POST /almacen/products/bulk-upsert/ — hasta 500 items por request. */
  bulkUpsert(body: ProductBulkUpsertRequest): Observable<ProductBulkUpsertResponse> {
    return this.http.post<ProductBulkUpsertResponse>(`${this.base}/bulk-upsert/`, body).pipe(
      tap(() => this.listCache.invalidate()),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`).pipe(tap(() => this.listCache.invalidate()));
  }
}

function readProducts(body: unknown): { rows: Product[]; bounded: boolean } {
  if (Array.isArray(body)) {
    return { rows: (body as Record<string, unknown>[]).map((row) => normalizeProduct(row)), bounded: false };
  }
  if (body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)) {
    const results = (body as { results: Record<string, unknown>[] }).results;
    return { rows: results.map((row) => normalizeProduct(row)), bounded: true };
  }
  return { rows: [], bounded: true };
}

function matchProducts(rows: Product[], query: string): Product[] {
  return rows.filter(
    (product) =>
      product.sku.toLowerCase().includes(query) ||
      product.description.toLowerCase().includes(query) ||
      String(product.id).includes(query),
  );
}
