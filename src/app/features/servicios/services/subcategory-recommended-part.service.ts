import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  RecommendedPartsImportResult,
  SubcategoryRecommendedPart,
  SubcategoryRecommendedPartWritePayload,
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

function parseBool(v: unknown, fallback = true): boolean {
  if (v == null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return fallback;
}

function normalizePart(row: Record<string, unknown>): SubcategoryRecommendedPart {
  const subRaw = row['subcategory'] ?? row['subcategory_id'];
  return {
    id: Number(row['id']),
    subcategory: fkId(subRaw) ?? 0,
    subcategory_name: optStr(row['subcategory_name']) ?? nestedName(subRaw),
    name: String(row['name'] ?? ''),
    description: optStr(row['description']),
    sort_order: optNum(row['sort_order']) ?? 0,
    is_active: parseBool(row['is_active'], true),
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
export class SubcategoryRecommendedPartService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/subcategory-recommended-parts`;

  list(opts?: {
    subcategory_id?: number;
    is_active?: boolean;
  }): Observable<SubcategoryRecommendedPart[]> {
    let params = new HttpParams();
    if (opts?.subcategory_id != null) {
      params = params.set('subcategory_id', String(opts.subcategory_id));
    }
    if (opts?.is_active != null) {
      params = params.set('is_active', String(opts.is_active));
    }
    return this.http.get<unknown>(`${this.base}/`, { params }).pipe(
      map((raw) =>
        unwrapList(raw)
          .map((r) => normalizePart(r))
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      ),
    );
  }

  create(body: SubcategoryRecommendedPartWritePayload): Observable<SubcategoryRecommendedPart> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, body)
      .pipe(map((r) => normalizePart(r)));
  }

  update(
    id: number,
    body: Partial<SubcategoryRecommendedPartWritePayload>,
  ): Observable<SubcategoryRecommendedPart> {
    return this.http
      .patch<Record<string, unknown>>(`${this.base}/${id}/`, body)
      .pipe(map((r) => normalizePart(r)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /** POST multipart `file` → /import-excel/ */
  importExcel(file: File): Observable<RecommendedPartsImportResult> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<RecommendedPartsImportResult>(`${this.base}/import-excel/`, fd);
  }
}
