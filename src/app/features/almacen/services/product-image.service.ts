import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ProductImage } from '../models/almacen.models';

function fkProduct(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'id' in v) {
    return Number((v as { id: unknown }).id);
  }
  return 0;
}

function normalizeImage(row: Record<string, unknown>): ProductImage {
  return {
    id: Number(row['id']),
    product: fkProduct(row['product'] ?? row['product_id']),
    name: String(row['name'] ?? ''),
    url: String(row['url'] ?? ''),
    primary: Boolean(row['primary'] ?? row['is_primary']),
  };
}

@Injectable({ providedIn: 'root' })
export class ProductImageService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/almacen/product-images`;

  list(): Observable<ProductImage[]> {
    return this.http.get<unknown[]>(`${this.base}/`).pipe(
      map((rows) => (rows as Record<string, unknown>[]).map((r) => normalizeImage(r))),
    );
  }

  listForProduct(productId: number): Observable<ProductImage[]> {
    return this.list().pipe(
      map((rows) => rows.filter((img) => img.product === productId)),
    );
  }

  get(id: number): Observable<ProductImage> {
    return this.http.get<Record<string, unknown>>(`${this.base}/${id}/`).pipe(
      map((r) => normalizeImage(r)),
    );
  }

  create(body: Partial<ProductImage>): Observable<ProductImage> {
    return this.http.post<Record<string, unknown>>(`${this.base}/`, body).pipe(
      map((r) => normalizeImage(r)),
    );
  }

  update(id: number, body: Partial<ProductImage>): Observable<ProductImage> {
    return this.http.patch<Record<string, unknown>>(`${this.base}/${id}/`, body).pipe(
      map((r) => normalizeImage(r)),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /**
   * Multipart: `file` y `product_id` obligatorios; `name` y `primary` opcionales.
   */
  upload(
    file: File,
    productId: number,
    opts?: { name?: string; primary?: boolean },
  ): Observable<ProductImage> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('product_id', String(productId));
    if (opts?.name != null && opts.name !== '') {
      fd.append('name', opts.name);
    }
    if (opts?.primary === true) {
      fd.append('primary', 'true');
    }
    return this.http.post<Record<string, unknown>>(`${this.base}/upload/`, fd).pipe(
      map((r) => normalizeImage(r)),
    );
  }
}
