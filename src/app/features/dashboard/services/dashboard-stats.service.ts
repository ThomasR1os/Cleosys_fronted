import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { QuotationService } from '../../ventas/services/quotation.service';
import type { QuotationRow } from '../../ventas/models/ventas.models';
import type {
  AdvisorBucket,
  DashboardDatePreset,
  DashboardFilters,
  DashboardKpis,
  DashboardStats,
  ReportGrouping,
  StatusBucket,
  TimeBucket,
  TypeBucket,
} from '../models/dashboard.models';

const STATUS_LABELS: Record<string, string> = {
  APROBADA: 'Aprobadas',
  PENDIENTE: 'Pendientes',
  RECHAZADA: 'Rechazadas',
};

const TYPE_LABELS: Record<string, string> = {
  VENTA: 'Venta',
  ALQUILER: 'Alquiler',
  SERVICIO: 'Servicio',
};

@Injectable({ providedIn: 'root' })
export class DashboardStatsService {
  private readonly quotationService = inject(QuotationService);

  loadStats(filters: DashboardFilters): Observable<DashboardStats> {
    return this.quotationService.list().pipe(map((rows) => this.computeStats(rows, filters)));
  }

  computeStats(rows: QuotationRow[], filters: DashboardFilters): DashboardStats {
    const advisors = this.extractAdvisors(rows);
    const dateRange = this.resolveDateRange(filters, rows);
    const filtered = rows.filter((row) => this.matchesFilters(row, filters, dateRange));

    const { from, to } = dateRange ?? this.defaultChartRange(rows);

    return {
      filtered,
      kpis: this.computeKpis(filtered),
      timeSeries: this.buildTimeSeries(filtered, filters.grouping, from, to),
      byStatus: this.buildStatusBuckets(filtered),
      byType: this.buildTypeBuckets(filtered),
      byAdvisor: this.buildAdvisorBuckets(filtered),
      advisors,
    };
  }

  resolveDateRange(
    filters: DashboardFilters,
    rows: QuotationRow[],
  ): { from: Date; to: Date } | null {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (filters.datePreset === 'custom' && filters.dateFrom && filters.dateTo) {
      const from = this.parseDateStart(filters.dateFrom);
      const to = this.parseDateEnd(filters.dateTo);
      if (from && to) {
        return { from, to };
      }
    }

    switch (filters.datePreset) {
      case 'last7': {
        const from = new Date(endOfToday);
        from.setDate(from.getDate() - 6);
        from.setHours(0, 0, 0, 0);
        return { from, to: endOfToday };
      }
      case 'last30': {
        const from = new Date(endOfToday);
        from.setDate(from.getDate() - 29);
        from.setHours(0, 0, 0, 0);
        return { from, to: endOfToday };
      }
      case 'thisMonth':
        return {
          from: new Date(now.getFullYear(), now.getMonth(), 1),
          to: endOfToday,
        };
      case 'lastMonth': {
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { from, to };
      }
      case 'thisYear':
        return {
          from: new Date(now.getFullYear(), 0, 1),
          to: endOfToday,
        };
      case 'lastYear':
        return {
          from: new Date(now.getFullYear() - 1, 0, 1),
          to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
        };
      case 'all':
        return null;
      default:
        return {
          from: new Date(now.getFullYear(), now.getMonth(), 1),
          to: endOfToday,
        };
    }
  }

  private defaultChartRange(rows: QuotationRow[]): { from: Date; to: Date } {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const dates = rowsDates(rows);
    if (dates.length === 0) {
      const from = new Date(endOfToday);
      from.setFullYear(from.getFullYear() - 1);
      from.setHours(0, 0, 0, 0);
      return { from, to: endOfToday };
    }
    return {
      from: new Date(Math.min(...dates.map((d) => d.getTime()))),
      to: endOfToday,
    };
  }

  private matchesFilters(
    row: QuotationRow,
    filters: DashboardFilters,
    dateRange: { from: Date; to: Date } | null,
  ): boolean {
    if (dateRange) {
      const created = this.parseRowDate(row.creation_date);
      if (!created || created < dateRange.from || created > dateRange.to) {
        return false;
      }
    }
    if (filters.status !== 'ALL' && row.status !== filters.status) {
      return false;
    }
    if (filters.quotationType !== 'ALL' && row.quotation_type !== filters.quotationType) {
      return false;
    }
    if (filters.money !== 'ALL' && row.money !== filters.money) {
      return false;
    }
    if (filters.advisorId !== 'ALL' && row.user !== filters.advisorId) {
      return false;
    }
    return true;
  }

  private computeKpis(rows: QuotationRow[]): DashboardKpis {
    const approved = rows.filter((r) => r.status === 'APROBADA').length;
    const pending = rows.filter((r) => r.status === 'PENDIENTE').length;
    const rejected = rows.filter((r) => r.status === 'RECHAZADA').length;
    const total = rows.length;

    const penRows = rows.filter((r) => r.money === 'PEN');
    const usdRows = rows.filter((r) => r.money === 'USD');

    const totalAmountPen = penRows.reduce((sum, r) => sum + this.parseAmount(r.final_price), 0);
    const totalAmountUsd = usdRows.reduce((sum, r) => sum + this.parseAmount(r.final_price), 0);

    return {
      total,
      approved,
      pending,
      rejected,
      approvalRate: total > 0 ? (approved / total) * 100 : 0,
      totalAmountPen,
      totalAmountUsd,
      avgAmountPen: penRows.length > 0 ? totalAmountPen / penRows.length : 0,
      avgAmountUsd: usdRows.length > 0 ? totalAmountUsd / usdRows.length : 0,
    };
  }

  private buildTimeSeries(
    rows: QuotationRow[],
    grouping: ReportGrouping,
    from: Date,
    to: Date,
  ): TimeBucket[] {
    const buckets = new Map<string, TimeBucket>();

    for (const row of rows) {
      const created = this.parseRowDate(row.creation_date);
      if (!created) continue;
      const key = this.bucketKey(created, grouping);
      const label = this.bucketLabel(created, grouping);
      const existing = buckets.get(key) ?? { key, label, count: 0, amountPen: 0, amountUsd: 0 };
      existing.count += 1;
      const amount = this.parseAmount(row.final_price);
      if (row.money === 'PEN') {
        existing.amountPen += amount;
      } else {
        existing.amountUsd += amount;
      }
      buckets.set(key, existing);
    }

    const series: TimeBucket[] = [];
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= to) {
      const key = this.bucketKey(cursor, grouping);
      const label = this.bucketLabel(cursor, grouping);
      series.push(buckets.get(key) ?? { key, label, count: 0, amountPen: 0, amountUsd: 0 });
      this.advanceCursor(cursor, grouping);
    }

    return series;
  }

  private buildStatusBuckets(rows: QuotationRow[]): StatusBucket[] {
    const counts = { APROBADA: 0, PENDIENTE: 0, RECHAZADA: 0 };
    for (const row of rows) {
      counts[row.status] += 1;
    }
    return (['APROBADA', 'PENDIENTE', 'RECHAZADA'] as const).map((status) => ({
      status,
      label: STATUS_LABELS[status],
      count: counts[status],
    }));
  }

  private buildTypeBuckets(rows: QuotationRow[]): TypeBucket[] {
    const counts = { VENTA: 0, ALQUILER: 0, SERVICIO: 0 };
    for (const row of rows) {
      counts[row.quotation_type] += 1;
    }
    return (['VENTA', 'ALQUILER', 'SERVICIO'] as const).map((type) => ({
      type,
      label: TYPE_LABELS[type],
      count: counts[type],
    }));
  }

  private buildAdvisorBuckets(rows: QuotationRow[]): AdvisorBucket[] {
    const map = new Map<number, AdvisorBucket>();
    for (const row of rows) {
      const id = row.user;
      const label =
        row.user_detail?.nombre?.trim() ||
        [row.user_detail?.first_name, row.user_detail?.last_name].filter(Boolean).join(' ') ||
        row.user_detail?.username ||
        `Usuario #${id}`;
      const existing = map.get(id) ?? { id, label, count: 0, amountPen: 0, amountUsd: 0 };
      existing.count += 1;
      const amount = this.parseAmount(row.final_price);
      if (row.money === 'PEN') {
        existing.amountPen += amount;
      } else {
        existing.amountUsd += amount;
      }
      map.set(id, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  private extractAdvisors(rows: QuotationRow[]): { id: number; label: string }[] {
    const map = new Map<number, string>();
    for (const row of rows) {
      if (map.has(row.user)) continue;
      const label =
        row.user_detail?.nombre?.trim() ||
        [row.user_detail?.first_name, row.user_detail?.last_name].filter(Boolean).join(' ') ||
        row.user_detail?.username ||
        `Usuario #${row.user}`;
      map.set(row.user, label);
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  private bucketKey(date: Date, grouping: ReportGrouping): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (grouping === 'year') return `${y}`;
    if (grouping === 'month') return `${y}-${m}`;
    return `${y}-${m}-${d}`;
  }

  private bucketLabel(date: Date, grouping: ReportGrouping): string {
    if (grouping === 'year') {
      return String(date.getFullYear());
    }
    if (grouping === 'month') {
      return date.toLocaleDateString('es-PE', { month: 'short', year: 'numeric' });
    }
    return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
  }

  private advanceCursor(cursor: Date, grouping: ReportGrouping): void {
    if (grouping === 'year') {
      cursor.setFullYear(cursor.getFullYear() + 1, 0, 1);
      return;
    }
    if (grouping === 'month') {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      return;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  private parseRowDate(iso: string | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseDateStart(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseDateEnd(value: string): Date | null {
    if (!value) return null;
    const d = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseAmount(value: string | number | null | undefined): number {
    if (value == null || value === '') return 0;
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  }
}

function rowsDates(rows: QuotationRow[]): Date[] {
  return rows
    .map((r) => {
      if (!r.creation_date) return null;
      const d = new Date(r.creation_date);
      return Number.isNaN(d.getTime()) ? null : d;
    })
    .filter((d): d is Date => d !== null);
}
