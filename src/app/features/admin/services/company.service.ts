import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Company, CompanyBranding } from '../models/admin-users.models';
import { DEFAULT_COMPANY_BRANDING } from '../utils/company-branding.utils';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : res.results;
}

function normalizeBranding(raw: unknown): CompanyBranding | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const D = DEFAULT_COMPANY_BRANDING;
  const pickStr = (key: string, fallback: string): string => {
    const v = o[key];
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
  };
  return {
    primary: pickStr('primary', D.primary),
    primary_light: pickStr('primary_light', D.primary_light),
    muted: pickStr('muted', D.muted),
    border: pickStr('border', D.border),
    table_stripe: pickStr('table_stripe', D.table_stripe),
    emphasis_bar: pickStr('emphasis_bar', D.emphasis_bar),
    text_body: pickStr('text_body', D.text_body),
    text_label: pickStr('text_label', D.text_label),
    text_caption: pickStr('text_caption', D.text_caption),
    extensions:
      o['extensions'] != null && typeof o['extensions'] === 'object'
        ? (o['extensions'] as Record<string, unknown>)
        : undefined,
  };
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
  const branding =
    normalizeBranding(row['branding']) ?? { ...DEFAULT_COMPANY_BRANDING };
  return {
    id: Number(row['id']),
    ruc: String(row['ruc'] ?? ''),
    name: String(row['name'] ?? ''),
    legal_name: row['legal_name'] != null ? String(row['legal_name']) : undefined,
    address: row['address'] != null ? String(row['address']) : undefined,
    district: row['district'] != null ? String(row['district']) : undefined,
    logo,
    bank_accounts: String(row['bank_accounts'] ?? ''),
    branding,
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

  create(body: Pick<Company, 'ruc' | 'name' | 'bank_accounts'>): Observable<Company> {
    return this.http.post<Record<string, unknown>>(`${this.base}/`, body).pipe(
      map((r) => normalizeCompany(r)),
    );
  }

  update(
    id: number,
    body: Partial<Pick<Company, 'ruc' | 'name' | 'bank_accounts'>>,
  ): Observable<Company> {
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
    ruc: string,
    name: string,
    bank_accounts: string,
    logoFile: File | null,
  ): Observable<Company> {
    return this.create({ ruc, name, bank_accounts }).pipe(
      switchMap((co) => (logoFile ? this.uploadLogo(co.id, logoFile) : of(co))),
    );
  }

  /**
   * Edición: JSON para el nombre y, si hay archivo, POST upload_logo después (no hay ImageField en el serializer).
   */
  updateWithOptionalLogo(
    id: number,
    ruc: string,
    name: string,
    bank_accounts: string,
    logoFile: File | null,
  ): Observable<Company> {
    return this.update(id, { ruc, name, bank_accounts }).pipe(
      switchMap((co) => (logoFile ? this.uploadLogo(id, logoFile) : of(co))),
    );
  }

  /**
   * PATCH /api/companies/{id}/branding/ — parcial; admin. Respuesta: compañía completa con branding.
   */
  patchBranding(id: number, body: Partial<CompanyBranding>): Observable<Company> {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (k === 'extensions' && typeof v === 'object') payload[k] = v;
      else if (typeof v === 'string') payload[k] = v;
    }
    return this.http.patch<Record<string, unknown>>(`${this.base}/${id}/branding/`, payload).pipe(
      map((r) => normalizeCompany(r)),
    );
  }
}
