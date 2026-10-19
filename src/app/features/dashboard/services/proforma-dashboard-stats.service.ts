import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import type {
  ProformaEntryChannel,
  ProformaRequestRow,
  ProformaRequestType,
  ProformaWorkflowStatus,
} from '../../ventas/models/ventas.models';
import { ProformaRequestService } from '../../ventas/services/proforma-request.service';
import {
  WORKFLOW_STATUSES,
  dueIsOverdue,
  effectiveWorkflow,
  userDisplayName,
  workflowLabel,
} from '../../ventas/utils/proforma-workflow.utils';
import type {
  ProformaAssigneeBucket,
  ProformaDashboardFilters,
  ProformaDashboardKpis,
  ProformaDashboardStats,
  ProformaNamedBucket,
  ProformaReportSegment,
  ProformaTimeBucket,
} from '../models/dashboard.models';

const TYPE_LABELS: Record<ProformaRequestType, string> = {
  MAQUINARIA: 'Maquinaria',
  REPUESTOS: 'Repuestos',
  SERVICIOS: 'Servicios',
  ALQUILERES: 'Alquileres',
};

const CHANNEL_LABELS: Record<ProformaEntryChannel, string> = {
  META: 'Meta',
  GOOGLE_ADS: 'Google Ads',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

const LOGISTICS_STATUSES: readonly ProformaWorkflowStatus[] = [
  'PENDING_LOGISTICS',
  'WAITING_SUPPLIER',
  'LOGISTICS_PROCESSING',
  'WAITING_SALES_INFORMATION',
];

const SALES_STATUSES: readonly ProformaWorkflowStatus[] = [
  'DRAFT',
  'PENDING_SALES',
  'STOCK_REVIEW',
  'PENDING_SALES_REVIEW',
  'QUOTATION_READY',
];

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
export class ProformaDashboardStatsService {
  private readonly proformaService = inject(ProformaRequestService);
  private cachedRows: ProformaRequestRow[] | null = null;

  loadRows(options?: { force?: boolean }): Observable<ProformaRequestRow[]> {
    if (this.cachedRows && !options?.force) {
      return of(this.cachedRows);
    }
    return this.proformaService.list().pipe(
      tap((rows) => {
        this.cachedRows = rows;
      }),
    );
  }

  computeStats(rows: ProformaRequestRow[], filters: ProformaDashboardFilters): ProformaDashboardStats {
    const assignees = this.extractAssignees(rows);
    const years = this.extractYears(rows);
    const dateRange = this.resolveDateRange(filters);
    const filtered = rows.filter((row) => this.matchesFilters(row, filters, dateRange));

    return {
      filtered,
      kpis: this.computeKpis(filtered),
      timeSeries: this.buildTimeSeries(filtered, filters.year, filters.month),
      byWorkflow: this.buildWorkflowBuckets(filtered),
      byType: this.buildNamedBuckets(
        filtered,
        ['MAQUINARIA', 'REPUESTOS', 'SERVICIOS', 'ALQUILERES'],
        (row) => row.proforma_type,
        TYPE_LABELS,
      ),
      byChannel: this.buildNamedBuckets(
        filtered,
        ['WHATSAPP', 'EMAIL', 'META', 'GOOGLE_ADS'],
        (row) => row.entry_channel,
        CHANNEL_LABELS,
      ),
      byAssignee: this.buildAssigneeBuckets(filtered),
      assignees,
      years,
    };
  }

  resolveDateRange(filters: ProformaDashboardFilters): { from: Date; to: Date } {
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

  /** Fecha del reporte: ingreso del requerimiento; si no existe, última actualización. */
  reportDate(row: ProformaRequestRow): Date | null {
    return this.parseRowDate(row.entered_at || row.updated_at);
  }

  private matchesFilters(
    row: ProformaRequestRow,
    filters: ProformaDashboardFilters,
    dateRange: { from: Date; to: Date },
  ): boolean {
    const when = this.reportDate(row);
    if (!when || when < dateRange.from || when > dateRange.to) {
      return false;
    }
    if (!this.matchesSegment(effectiveWorkflow(row), filters.segment)) {
      return false;
    }
    if (filters.proformaType !== 'ALL' && row.proforma_type !== filters.proformaType) {
      return false;
    }
    if (filters.channel !== 'ALL' && row.entry_channel !== filters.channel) {
      return false;
    }
    if (filters.assigneeId !== 'ALL' && row.assigned_user !== filters.assigneeId) {
      return false;
    }
    return true;
  }

  private matchesSegment(status: ProformaWorkflowStatus, segment: ProformaReportSegment): boolean {
    switch (segment) {
      case 'ALL':
        return true;
      case 'OPEN':
        return status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'NOT_POSSIBLE';
      case 'LOGISTICS':
        return LOGISTICS_STATUSES.includes(status);
      case 'SALES':
        return SALES_STATUSES.includes(status);
      case 'DONE':
        return status === 'COMPLETED';
      case 'CLOSED':
        return status === 'CANCELLED' || status === 'NOT_POSSIBLE';
    }
  }

  private computeKpis(rows: ProformaRequestRow[]): ProformaDashboardKpis {
    let open = 0;
    let completed = 0;
    let closed = 0;
    let overdue = 0;
    let withQuotation = 0;

    for (const row of rows) {
      const workflow = effectiveWorkflow(row);
      if (workflow === 'COMPLETED') completed += 1;
      else if (workflow === 'CANCELLED' || workflow === 'NOT_POSSIBLE') closed += 1;
      else open += 1;
      if (dueIsOverdue(row.due_at, workflow)) overdue += 1;
      if (row.quotation != null) withQuotation += 1;
    }

    return {
      total: rows.length,
      open,
      completed,
      closed,
      overdue,
      withQuotation,
    };
  }

  private buildTimeSeries(
    rows: ProformaRequestRow[],
    year: number,
    month: number | 'ALL',
  ): ProformaTimeBucket[] {
    const buckets = new Map<string, ProformaTimeBucket>();

    for (const row of rows) {
      const when = this.reportDate(row);
      if (!when) continue;
      const key = this.monthKey(when);
      const existing = buckets.get(key) ?? {
        key,
        label: this.monthLabel(when),
        count: 0,
        withQuotation: 0,
      };
      existing.count += 1;
      if (row.quotation != null) existing.withQuotation += 1;
      buckets.set(key, existing);
    }

    const startMonth = month === 'ALL' ? 1 : month;
    const now = new Date();
    const endMonth =
      month === 'ALL' ? (year === now.getFullYear() ? now.getMonth() + 1 : 12) : month;

    const series: ProformaTimeBucket[] = [];
    for (let m = startMonth; m <= endMonth; m++) {
      const cursor = new Date(year, m - 1, 1);
      const key = this.monthKey(cursor);
      series.push(
        buckets.get(key) ?? {
          key,
          label: this.monthLabel(cursor),
          count: 0,
          withQuotation: 0,
        },
      );
    }
    return series;
  }

  private buildWorkflowBuckets(rows: ProformaRequestRow[]): ProformaNamedBucket[] {
    const counts = new Map<ProformaWorkflowStatus, number>();
    for (const status of WORKFLOW_STATUSES) counts.set(status, 0);
    for (const row of rows) {
      const status = effectiveWorkflow(row);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return WORKFLOW_STATUSES.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => ({
      key: status,
      label: workflowLabel(status),
      count: counts.get(status) ?? 0,
    }));
  }

  private buildNamedBuckets<T extends string>(
    rows: ProformaRequestRow[],
    keys: readonly T[],
    pick: (row: ProformaRequestRow) => T,
    labels: Record<T, string>,
  ): ProformaNamedBucket[] {
    const counts = new Map<T, number>(keys.map((key) => [key, 0]));
    for (const row of rows) {
      const key = pick(row);
      if (!counts.has(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return keys.map((key) => ({
      key,
      label: labels[key],
      count: counts.get(key) ?? 0,
    }));
  }

  private buildAssigneeBuckets(rows: ProformaRequestRow[]): ProformaAssigneeBucket[] {
    const map = new Map<number, ProformaAssigneeBucket>();
    for (const row of rows) {
      const id = row.assigned_user || 0;
      const existing = map.get(id) ?? {
        id,
        label: this.assigneeLabel(row),
        count: 0,
        overdue: 0,
      };
      existing.count += 1;
      if (dueIsOverdue(row.due_at, effectiveWorkflow(row))) existing.overdue += 1;
      map.set(id, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  private extractAssignees(rows: ProformaRequestRow[]): { id: number; label: string }[] {
    const map = new Map<number, string>();
    for (const row of rows) {
      const id = row.assigned_user || 0;
      if (map.has(id)) continue;
      map.set(id, this.assigneeLabel(row));
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  private extractYears(rows: ProformaRequestRow[]): number[] {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const row of rows) {
      const when = this.reportDate(row);
      if (when) set.add(when.getFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }

  private assigneeLabel(row: ProformaRequestRow): string {
    if (!row.assigned_user) return 'Sin asignar';
    return userDisplayName(row.assigned_user_detail, row.assigned_user);
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
}
