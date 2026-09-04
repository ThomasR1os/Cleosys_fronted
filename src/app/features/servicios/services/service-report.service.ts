import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  ReportPartCheck,
  ReportPhoto,
  ReportPhotoWritePayload,
  ServiceReport,
  ServiceReportListFilters,
  ServiceReportWritePayload,
} from '../models/servicios.models';
import { normalizeElectricalEvaluation } from './machine.service';

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

function nestedName(v: unknown): string | null {
  if (v == null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const full = [o['first_name'], o['last_name']].filter(Boolean).join(' ').trim();
  if (full) return full;
  if ('username' in o) {
    const u = String(o['username'] ?? '').trim();
    if (u) return u;
  }
  if ('name' in o) {
    const n = String(o['name'] ?? '').trim();
    if (n) return n;
  }
  return null;
}

export function normalizeReportPhoto(row: Record<string, unknown>): ReportPhoto {
  return {
    id: Number(row['id']),
    report: fkId(row['report'] ?? row['report_id']) ?? undefined,
    photo_url: String(row['photo_url'] ?? ''),
    label: optStr(row['label']) ?? 'BEFORE',
    note: optStr(row['note']),
    sort_order: optNum(row['sort_order']) ?? 0,
    created_at: optStr(row['created_at']),
  };
}

function normalizePhotos(raw: unknown): ReportPhoto[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((r) => normalizeReportPhoto(r))
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

export function normalizeServiceReport(row: Record<string, unknown>): ServiceReport {
  const createdByRaw = row['created_by'] ?? row['created_by_id'];
  const checksRaw = row['part_checks'];
  const part_checks: ReportPartCheck[] = Array.isArray(checksRaw)
    ? (checksRaw as Record<string, unknown>[]).map((c) => {
        const partRaw = c['recommended_part'] ?? c['recommended_part_id'];
        return {
          id: optNum(c['id']) ?? undefined,
          recommended_part: fkId(partRaw) ?? 0,
          recommended_part_name:
            optStr(c['recommended_part_name']) ?? nestedName(partRaw),
          condition: optStr(c['condition']) ?? 'OK',
          part_number: optStr(c['part_number']),
          notes: optStr(c['notes']),
        };
      })
    : [];

  return {
    id: Number(row['id']),
    correlativo: optStr(row['correlativo']),
    type: optStr(row['type']) ?? 'EVALUATION',
    machine: fkId(row['machine'] ?? row['machine_id']) ?? 0,
    origin_report: fkId(row['origin_report'] ?? row['origin_report_id']),
    intervention_date: String(row['intervention_date'] ?? '').slice(0, 10),
    hour_meter: optNum(row['hour_meter']),
    current_condition: optStr(row['current_condition']),
    work_performed: optStr(row['work_performed']),
    background: optStr(row['background']),
    conclusions: optStr(row['conclusions']),
    recommendations: optStr(row['recommendations']),
    part_checks,
    photos: normalizePhotos(row['photos']),
    electrical_evaluation: normalizeElectricalEvaluation(row['electrical_evaluation']),
    created_by: fkId(createdByRaw),
    created_by_name: optStr(row['created_by_name']) ?? nestedName(createdByRaw),
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
export class ServiceReportService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/servicios/reports`;
  private readonly machinesBase = `${environment.apiUrl}/servicios/machines`;
  private readonly uploadBase = `${environment.apiUrl}/servicios/report-photos`;

  list(filters?: ServiceReportListFilters): Observable<ServiceReport[]> {
    let params = new HttpParams();
    if (filters?.machine_id != null) {
      params = params.set('machine_id', String(filters.machine_id));
    }
    if (filters?.type?.trim()) {
      params = params.set('type', filters.type.trim());
    }
    if (filters?.intervention_date_from?.trim()) {
      params = params.set('intervention_date_from', filters.intervention_date_from.trim());
    }
    if (filters?.intervention_date_to?.trim()) {
      params = params.set('intervention_date_to', filters.intervention_date_to.trim());
    }
    return this.http.get<unknown>(`${this.base}/`, { params }).pipe(
      map((raw) => unwrapList(raw).map((r) => normalizeServiceReport(r))),
    );
  }

  /** GET /api/servicios/machines/{id}/reports/ */
  listForMachine(machineId: number): Observable<ServiceReport[]> {
    return this.http.get<unknown>(`${this.machinesBase}/${machineId}/reports/`).pipe(
      map((raw) => unwrapList(raw).map((r) => normalizeServiceReport(r))),
    );
  }

  get(id: number): Observable<ServiceReport> {
    return this.http
      .get<Record<string, unknown>>(`${this.base}/${id}/`)
      .pipe(map((r) => normalizeServiceReport(r)));
  }

  create(body: ServiceReportWritePayload): Observable<ServiceReport> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/`, body)
      .pipe(map((r) => normalizeServiceReport(r)));
  }

  update(id: number, body: Partial<ServiceReportWritePayload>): Observable<ServiceReport> {
    return this.http
      .patch<Record<string, unknown>>(`${this.base}/${id}/`, body)
      .pipe(map((r) => normalizeServiceReport(r)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /** GET /api/servicios/reports/{id}/photos/ */
  listPhotos(reportId: number): Observable<ReportPhoto[]> {
    return this.http.get<unknown>(`${this.base}/${reportId}/photos/`).pipe(
      map((raw) => normalizePhotos(unwrapList(raw))),
    );
  }

  /** POST /api/servicios/reports/{id}/photos/ — URL ya lista. */
  addPhoto(reportId: number, body: ReportPhotoWritePayload): Observable<ReportPhoto> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/${reportId}/photos/`, body)
      .pipe(map((r) => normalizeReportPhoto(r)));
  }

  /**
   * POST /api/servicios/report-photos/upload/
   * multipart: file, report_id, label, note?, sort_order?
   */
  uploadPhoto(
    file: File,
    reportId: number,
    opts: { label: string; note?: string | null; sort_order?: number },
  ): Observable<ReportPhoto> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('report_id', String(reportId));
    fd.append('label', opts.label);
    if (opts.note != null && opts.note.trim() !== '') {
      fd.append('note', opts.note.trim());
    }
    if (opts.sort_order != null) {
      fd.append('sort_order', String(opts.sort_order));
    }
    return this.http
      .post<Record<string, unknown>>(`${this.uploadBase}/upload/`, fd)
      .pipe(map((r) => normalizeReportPhoto(r)));
  }
}
