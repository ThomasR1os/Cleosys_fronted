import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { QUERY_STALE_MS, StaleCache } from '../../../core/utils/stale-cache';
import { environment } from '../../../../environments/environment';
import type { ProductSupplierMoney, ProductSupplierRow } from '../models/logistica.models';
import { fetchDrfList, resolveDrfNext } from './drf-list';

/**
 * API bajo `/api/almacen/` con AlmacenWritePermission en escritura
 * (rol Almacén o Admin), aunque la pantalla viva en el módulo Logística.
 */
@Injectable({ providedIn: 'root' })
export class ProductSupplierService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/product-suppliers`;
  private readonly listCache = new StaleCache<ProductSupplierRow[]>(QUERY_STALE_MS);
  private readonly supplierCache = new Map<number, ProductSupplierRow[]>();
  private readonly supplierLoads = new Map<number, Observable<ProductSupplierRow[]>>();
  private readonly productCache = new Map<number, ProductSupplierRow[]>();
  private readonly productLoads = new Map<number, Observable<ProductSupplierRow[]>>();

  list(): Observable<ProductSupplierRow[]> {
    return this.listCache.read(() => {
      const params = new HttpParams().set('page_size', '200');
      return fetchDrfList(this.http, `${this.base}/`, params).pipe(
        map((rows) => rows.map((row) => normalizeProductSupplier(row))),
      );
    });
  }

  /** Precios de un proveedor. No descarga el catálogo de los demás. */
  listForSupplier(supplierId: number): Observable<ProductSupplierRow[]> {
    if (supplierId <= 0) return of([]);
    const all = this.listCache.fresh();
    if (all) return of(all.filter((row) => row.supplier === supplierId));
    const hit = this.supplierCache.get(supplierId);
    if (hit) return of(hit);
    const pending = this.supplierLoads.get(supplierId);
    if (pending) return pending;
    const params = new HttpParams().set('supplier', String(supplierId)).set('page_size', '200');
    const request = this.fetchSupplierPages(`${this.base}/`, params, supplierId, [], 0).pipe(
      tap((rows) => this.supplierCache.set(supplierId, rows)),
      finalize(() => this.supplierLoads.delete(supplierId)),
      shareReplay(1),
    );
    this.supplierLoads.set(supplierId, request);
    return request;
  }

  /** Tarifas de un producto. No recorre el catálogo de los demás. */
  listForProduct(productId: number): Observable<ProductSupplierRow[]> {
    if (productId <= 0) return of([]);
    const all = this.listCache.fresh();
    if (all) return of(all.filter((row) => row.product === productId));
    const hit = this.productCache.get(productId);
    if (hit) return of(hit);
    const pending = this.productLoads.get(productId);
    if (pending) return pending;
    const params = new HttpParams().set('product', String(productId)).set('page_size', '50');
    const request = this.http.get<unknown>(`${this.base}/`, { params }).pipe(
      map((body) => readSupplierPage(body).rows.filter((row) => row.product === productId)),
      tap((rows) => this.productCache.set(productId, rows)),
      finalize(() => this.productLoads.delete(productId)),
      shareReplay(1),
    );
    this.productLoads.set(productId, request);
    return request;
  }

  /**
   * Plazo para una cotización armada con datos del sistema.
   * Stock inmediato es "0". Si no, el menor tiempo estimado del producto–proveedor.
   */
  leadTimeLabel(productId: number, inStock = false): Observable<string> {
    if (inStock) return of('0');
    if (productId <= 0) return of('');
    return this.listForProduct(productId).pipe(
      map((rows) => {
        const days = rows
          .map((row) => row.estimated_lead_time_days)
          .filter((value): value is number => value != null && value >= 0);
        return days.length ? String(Math.min(...days)) : '';
      }),
      catchError(() => of('')),
    );
  }

  private fetchSupplierPages(
    url: string,
    params: HttpParams | undefined,
    supplierId: number,
    acc: ProductSupplierRow[],
    page: number,
  ): Observable<ProductSupplierRow[]> {
    if (!url || page >= 8) return of(acc);
    return this.http.get<unknown>(url, params ? { params } : {}).pipe(
      switchMap((body) => {
        const parsed = readSupplierPage(body);
        const matched = parsed.rows.filter((row) => row.supplier === supplierId);
        const nextAcc = acc.concat(matched);
        const filtered = parsed.rows.length === matched.length;
        if (!parsed.hasNext || !filtered) {
          if (!parsed.hasNext && parsed.rows.length > 40) this.listCache.write(parsed.rows);
          if (parsed.hasNext && !filtered) {
            return this.list().pipe(map((rows) => rows.filter((row) => row.supplier === supplierId)));
          }
          return of(nextAcc);
        }
        const next = resolveDrfNext(parsed.nextUrl ?? '');
        if (!next) return of(nextAcc);
        return this.fetchSupplierPages(next, undefined, supplierId, nextAcc, page + 1);
      }),
    );
  }

  create(body: Partial<ProductSupplierRow>): Observable<ProductSupplierRow> {
    return this.http.post<ProductSupplierRow>(`${this.base}/`, body).pipe(tap(() => this.invalidate()));
  }

  update(id: number, body: Partial<ProductSupplierRow>): Observable<ProductSupplierRow> {
    return this.http.patch<ProductSupplierRow>(`${this.base}/${id}/`, body).pipe(tap(() => this.invalidate()));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`).pipe(tap(() => this.invalidate()));
  }

  /** POST /almacen/product-suppliers/bulk-upsert/ — hasta 500 ítems por request. */
  bulkUpsert(body: ProductSupplierBulkUpsertRequest): Observable<ProductSupplierBulkUpsertResponse> {
    return this.http
      .post<ProductSupplierBulkUpsertResponse>(`${this.base}/bulk-upsert/`, body)
      .pipe(tap(() => this.invalidate()));
  }

  private invalidate(): void {
    this.listCache.invalidate();
    this.supplierCache.clear();
    this.supplierLoads.clear();
    this.productCache.clear();
    this.productLoads.clear();
  }
}

function readSupplierPage(body: unknown): { rows: ProductSupplierRow[]; hasNext: boolean; nextUrl: string | null } {
  if (Array.isArray(body)) {
    return {
      rows: (body as Record<string, unknown>[]).map((row) => normalizeProductSupplier(row)),
      hasNext: false,
      nextUrl: null,
    };
  }
  if (body && typeof body === 'object') {
    const page = body as { results?: unknown; next?: unknown };
    const results = Array.isArray(page.results) ? (page.results as Record<string, unknown>[]) : [];
    const nextUrl = typeof page.next === 'string' && page.next.length > 0 ? page.next : null;
    return {
      rows: results.map((row) => normalizeProductSupplier(row)),
      hasNext: nextUrl != null,
      nextUrl,
    };
  }
  return { rows: [], hasNext: false, nextUrl: null };
}

export type ProductSupplierBulkItem = {
  sku: string;
  supplier_ruc: string;
  money: ProductSupplierMoney;
  cost: string;
  incoterm: string;
  /** Días. Si el Excel no trae la columna, no se envía y el valor actual se conserva. */
  estimated_lead_time_days?: number | null;
};

export type ProductSupplierBulkUpsertRequest = {
  mode: 'upsert';
  items: ProductSupplierBulkItem[];
};

export type ProductSupplierBulkUpsertError = {
  index: number;
  sku?: string;
  supplier_ruc?: string;
  message: string;
};

export type ProductSupplierBulkUpsertResponse = {
  created: number;
  updated: number;
  failed: number;
  errors: ProductSupplierBulkUpsertError[];
};

function fkId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return fkId((value as { id: unknown }).id);
  }
  return 0;
}

function optionalDays(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function normalizeProductSupplier(raw: Record<string, unknown>): ProductSupplierRow {
  const money: ProductSupplierMoney =
    String(raw['money'] ?? '')
      .trim()
      .toUpperCase() === 'USD'
      ? 'USD'
      : 'PEN';
  return {
    id: fkId(raw['id']),
    money,
    product: fkId(raw['product']),
    supplier: fkId(raw['supplier']),
    cost: raw['cost'] == null || raw['cost'] === '' ? '0' : String(raw['cost']),
    incoterm: String(raw['incoterm'] ?? ''),
    estimated_lead_time_days: optionalDays(raw['estimated_lead_time_days']),
    creation_date: raw['creation_date'] != null ? String(raw['creation_date']) : undefined,
  };
}
