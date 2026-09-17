import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { QuotationService } from '../../ventas/services/quotation.service';
import type { QuotationRow } from '../../ventas/models/ventas.models';
import type {
  AdvisorBucket,
  DashboardFilters,
  DashboardKpis,
  DashboardStats,
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

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Injectable({ providedIn: 'root' })
export class DashboardStatsService {
  private readonly quotationService = inject(QuotationService);
  private cachedRows: QuotationRow[] | null = null;

  loadStats(filters: DashboardFilters, options?: { force?: boolean }): Observable<DashboardStats> {
    if (this.cachedRows && !options?.force) {
      return of(this.computeStats(this.cachedRows, filters));
    }
    return this.quotationService.list().pipe(
      map((rows) => {
        this.cachedRows = rows;
        return this.computeStats(rows, filters);
      }),
    );
  }

  computeStats(rows: QuotationRow[], filters: DashboardFilters): DashboardStats {
    const advisors = this.extractAdvisors(rows);
    const years = this.extractYears(rows);
    const dateRange = this.resolveDateRange(filters);
    const filtered = rows.filter((row) => this.matchesFilters(row, filters, dateRange));

    return {
      filtered,
      kpis: this.computeKpis(filtered),
      timeSeries: this.buildTimeSeries(filtered, filters.year, filters.month),
      byStatus: this.buildStatusBuckets(filtered),
      byType: this.buildTypeBuckets(filtered),
      byAdvisor: this.buildAdvisorBuckets(filtered),
      advisors,
      years,
    };
  }

  resolveDateRange(filters: DashboardFilters): { from: Date; to: Date } {
    if (filters.month === 'ALL') {
      return {
        from: new Date(filters.year, 0, 1),
        to: new Date(filters.year, 11, 31, 23, 59, 59, 999),
      };
    }
    const monthIndex = filters.month - 1;
    return {
      from: new Date(filters.year, monthIndex, 1),
      to: new Date(filters.year, monthIndex + 1, 0, 23, 59, 59, 999),
    };
  }

  /** Fecha del reporte: cambio de estado si existe; si no, creación. */
  reportDate(row: QuotationRow): Date | null {
    return this.parseRowDate(row.approved_at || row.update_date || row.creation_date);
  }

  private matchesFilters(
    row: QuotationRow,
    filters: DashboardFilters,
    dateRange: { from: Date; to: Date },
  ): boolean {
    const when = this.reportDate(row);
    if (!when || when < dateRange.from || when > dateRange.to) {
      return false;
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
    year: number,
    month: number | 'ALL',
  ): TimeBucket[] {
    const buckets = new Map<string, TimeBucket>();

    for (const row of rows) {
      const when = this.reportDate(row);
      if (!when) continue;
      const key = this.monthKey(when);
      const existing = buckets.get(key) ?? {
        key,
        label: this.monthLabel(when),
        count: 0,
        amountPen: 0,
        amountUsd: 0,
      };
      existing.count += 1;
      const amount = this.parseAmount(row.final_price);
      if (row.money === 'PEN') {
        existing.amountPen += amount;
      } else {
        existing.amountUsd += amount;
      }
      buckets.set(key, existing);
    }

    const startMonth = month === 'ALL' ? 1 : month;
    const now = new Date();
    const endMonth =
      month === 'ALL'
        ? year === now.getFullYear()
          ? now.getMonth() + 1
          : 12
        : month;

    const series: TimeBucket[] = [];
    for (let m = startMonth; m <= endMonth; m++) {
      const cursor = new Date(year, m - 1, 1);
      const key = this.monthKey(cursor);
      series.push(
        buckets.get(key) ?? {
          key,
          label: this.monthLabel(cursor),
          count: 0,
          amountPen: 0,
          amountUsd: 0,
        },
      );
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
      const label = advisorLabelFromRow(row);
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
      map.set(row.user, advisorLabelFromRow(row));
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  private extractYears(rows: QuotationRow[]): number[] {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const row of rows) {
      const when = this.reportDate(row);
      if (when) set.add(when.getFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }

  private monthKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private monthLabel(date: Date): string {
    return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
  }

  private parseRowDate(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseAmount(value: string | number | null | undefined): number {
    if (value == null || value === '') return 0;
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  }
}

function advisorLabelFromRow(row: QuotationRow): string {
  return (
    row.user_detail?.nombre?.trim() ||
    [row.user_detail?.first_name, row.user_detail?.last_name].filter(Boolean).join(' ') ||
    row.user_detail?.username ||
    `Usuario #${row.user}`
  );
}
