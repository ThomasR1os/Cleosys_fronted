import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Company } from '../models/admin-users.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : res.results;
}

function normalizeCompany(row: Record<string, unknown>): Company {
  /** API Django: URLField `logo_url` (Cloudinary), no hay campo `logo` en multipart. */
  const logoRaw = row['logo_url'] ?? row['logo'];
  let logo: string | null | undefined;
  if (logoRaw == null || logoRaw === '') {
    logo = null;
  } else if (typeof logoRaw === 'string') {
    logo = logoRaw;
  } else {
    logo = null;
  }
  return {
    id: Number(row['id']),
    name: String(row['name'] ?? ''),
    logo,
    bank_accounts: String(row['bank_accounts'] ?? ''),
  };
}

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/companies`;

  list(): Observable<Company[]> {
    return this.http
      .get<Record<string, unknown>[] | { results: Record<string, unknown>[] }>(`${this.base}/`)
      .pipe(
        map((res) => unwrapList(res)),
        map((rows) => rows.map((r) => normalizeCompany(r))),
      );
  }

  retrieve(id: number): Observable<Company> {
    return this.http.get<Record<string, unknown>>(`${this.base}/${id}/`).pipe(
      map((r) => normalizeCompany(r)),
    );
  }

  create(body: Pick<Company, 'name' | 'bank_accounts'>): Observable<Company> {
    return this.http.post<Record<string, unknown>>(`${this.base}/`, body).pipe(
      map((r) => normalizeCompany(r)),
    );
  }

  update(id: number, body: Partial<Pick<Company, 'name' | 'bank_accounts'>>): Observable<Company> {
    return this.http.patch<Record<string, unknown>>(`${this.base}/${id}/`, body).pipe(
      map((r) => normalizeCompany(r)),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /**
   * Sube una imagen a Cloudinary vía backend y actualiza `logo_url`.
   * POST /api/companies/{id}/upload_logo/ — campo multipart `file` (igual que product-images).
   */
  uploadLogo(id: number, file: File): Observable<Company> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Record<string, unknown>>(`${this.base}/${id}/upload_logo/`, fd).pipe(
      map((r) => normalizeCompany(r)),
    );
  }

  /**
   * Alta: JSON y opcionalmente un logo en segunda petición.
   */
  createWithOptionalLogo(
    name: string,
    bank_accounts: string,
    logoFile: File | null,
  ): Observable<Company> {
    return this.create({ name, bank_accounts }).pipe(
      switchMap((co) => (logoFile ? this.uploadLogo(co.id, logoFile) : of(co))),
    );
  }

  /**
   * Edición: JSON para el nombre y, si hay archivo, POST upload_logo después (no hay ImageField en el serializer).
   */
  updateWithOptionalLogo(
    id: number,
    name: string,
    bank_accounts: string,
    logoFile: File | null,
  ): Observable<Company> {
    return this.update(id, { name, bank_accounts }).pipe(
      switchMap((co) => (logoFile ? this.uploadLogo(id, logoFile) : of(co))),
    );
  }
}
