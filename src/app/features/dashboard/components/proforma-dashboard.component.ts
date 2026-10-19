import { NgClass } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ShortDateTimePipe } from '../../../core/pipes/short-datetime.pipe';
import type {
  ProformaEntryChannel,
  ProformaRequestRow,
  ProformaRequestType,
} from '../../ventas/models/ventas.models';
import {
  dueIsOverdue,
  effectiveWorkflow,
  priorityLabel,
  requestCode,
  userDisplayName,
  workflowBadgeClass,
  workflowLabel,
} from '../../ventas/utils/proforma-workflow.utils';
import type {
  ProformaDashboardFilters,
  ProformaDashboardStats,
  ProformaReportSegment,
} from '../models/dashboard.models';
import { ProformaDashboardStatsService } from '../services/proforma-dashboard-stats.service';
import { DashboardChartComponent } from './dashboard-chart.component';
import { KpiCardComponent } from './kpi-card.component';

const CHART_COLORS = [
  'rgba(59, 130, 246, 0.85)',
  'rgba(14, 165, 233, 0.85)',
  'rgba(34, 197, 94, 0.85)',
  'rgba(234, 179, 8, 0.85)',
  'rgba(249, 115, 22, 0.85)',
  'rgba(168, 85, 247, 0.85)',
  'rgba(244, 114, 182, 0.85)',
  'rgba(20, 184, 166, 0.85)',
  'rgba(99, 102, 241, 0.85)',
  'rgba(239, 68, 68, 0.85)',
  'rgba(100, 116, 139, 0.85)',
  'rgba(132, 204, 22, 0.85)',
];

const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

const SEGMENTS: { id: ProformaReportSegment; label: string }[] = [
  { id: 'ALL', label: 'Todas' },
  { id: 'OPEN', label: 'Abiertas' },
  { id: 'LOGISTICS', label: 'En logística' },
  { id: 'SALES', label: 'En ventas' },
  { id: 'DONE', label: 'Finalizadas' },
  { id: 'CLOSED', label: 'No concretadas' },
];

@Component({
  selector: 'app-proforma-dashboard',
  imports: [NgClass, FormsModule, RouterLink, KpiCardComponent, DashboardChartComponent, ShortDateTimePipe],
  host: { class: 'block space-y-8' },
  templateUrl: './proforma-dashboard.component.html',
})
export class ProformaDashboardComponent {
  private readonly statsService = inject(ProformaDashboardStatsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly months = MONTHS;
  readonly segments = SEGMENTS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly stats = signal<ProformaDashboardStats | null>(null);

  private readonly now = new Date();
  readonly filterYear = signal(this.now.getFullYear());
  readonly filterMonth = signal<number | 'ALL'>(this.now.getMonth() + 1);
  readonly filterSegment = signal<ProformaReportSegment>('ALL');
  readonly filterType = signal<'ALL' | ProformaRequestType>('ALL');
  readonly filterChannel = signal<'ALL' | ProformaEntryChannel>('ALL');
  readonly filterAssignee = signal<number | 'ALL'>('ALL');

  private source: ProformaRequestRow[] | null = null;

  readonly filters = computed((): ProformaDashboardFilters => ({
    year: this.filterYear(),
    month: this.filterMonth(),
    segment: this.filterSegment(),
    proformaType: this.filterType(),
    channel: this.filterChannel(),
    assigneeId: this.filterAssignee(),
  }));

  readonly kpis = computed(() => this.stats()?.kpis ?? null);

  readonly periodLabel = computed(() => {
    const year = this.filterYear();
    const month = this.filterMonth();
    if (month === 'ALL') return `en ${year}`;
    const name = MONTHS.find((m) => m.value === month)?.label ?? '';
    return `en ${name} ${year}`;
  });

  readonly segmentLabel = computed(
    () => SEGMENTS.find((segment) => segment.id === this.filterSegment())?.label ?? 'Todas',
  );

  readonly hasMonthlyRows = computed(() =>
    (this.stats()?.timeSeries ?? []).some((row) => row.count > 0),
  );

  readonly sortedRequests = computed(() => {
    const rows = [...(this.stats()?.filtered ?? [])];
    return rows.sort((a, b) => this.reportDateMs(b) - this.reportDateMs(a));
  });

  readonly trendChartConfig = computed((): ChartConfiguration => {
    const series = this.stats()?.timeSeries ?? [];
    return {
      type: 'bar',
      data: {
        labels: series.map((b) => b.label),
        datasets: [
          {
            type: 'bar',
            label: 'Solicitudes',
            data: series.map((b) => b.count),
            backgroundColor: CHART_COLORS[0],
            borderRadius: 4,
          },
          {
            type: 'line',
            label: 'Con cotización',
            data: series.map((b) => b.withQuotation),
            borderColor: CHART_COLORS[2],
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            tension: 0.3,
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Cantidad' }, ticks: { stepSize: 1 } },
        },
      },
    };
  });

  readonly workflowChartConfig = computed((): ChartConfiguration => {
    const buckets = this.stats()?.byWorkflow ?? [];
    return {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          {
            label: 'Solicitudes',
            data: buckets.map((b) => b.count),
            backgroundColor: buckets.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    };
  });

  readonly typeChartConfig = computed((): ChartConfiguration => {
    const buckets = this.stats()?.byType ?? [];
    return {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          {
            label: 'Solicitudes',
            data: buckets.map((b) => b.count),
            backgroundColor: [CHART_COLORS[0], CHART_COLORS[5], CHART_COLORS[1], CHART_COLORS[3]],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    };
  });

  readonly channelChartConfig = computed((): ChartConfiguration => {
    const buckets = this.stats()?.byChannel ?? [];
    return {
      type: 'doughnut',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          {
            data: buckets.map((b) => b.count),
            backgroundColor: [CHART_COLORS[2], CHART_COLORS[0], CHART_COLORS[5], CHART_COLORS[4]],
            borderWidth: 0,
          },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' } } },
    };
  });

  readonly assigneeChartConfig = computed((): ChartConfiguration => {
    const assignees = (this.stats()?.byAssignee ?? []).slice(0, 8);
    return {
      type: 'bar',
      data: {
        labels: assignees.map((a) => a.label),
        datasets: [
          {
            label: 'Solicitudes',
            data: assignees.map((a) => a.count),
            backgroundColor: CHART_COLORS[6],
            borderRadius: 4,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    };
  });

  constructor() {
    this.reload(false);
  }

  reload(force = true): void {
    this.loading.set(true);
    this.error.set(null);
    this.statsService
      .loadRows({ force })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.source = rows;
          this.stats.set(this.statsService.computeStats(rows, this.filters()));
          this.loading.set(false);
        },
        error: () => {
          this.error.set('No se pudieron cargar las estadísticas de solicitudes de proforma.');
          this.loading.set(false);
        },
      });
  }

  onFiltersChange(): void {
    if (!this.source) return;
    this.stats.set(this.statsService.computeStats(this.source, this.filters()));
  }

  setSegment(segment: ProformaReportSegment): void {
    this.filterSegment.set(segment);
    this.onFiltersChange();
  }

  onYearChange(value: number | string): void {
    this.filterYear.set(Number(value));
    this.onFiltersChange();
  }

  onMonthChange(value: number | 'ALL' | string): void {
    this.filterMonth.set(value === 'ALL' ? 'ALL' : Number(value));
    this.onFiltersChange();
  }

  workflowOf(row: ProformaRequestRow) {
    return effectiveWorkflow(row);
  }

  workflowText(row: ProformaRequestRow): string {
    return workflowLabel(this.workflowOf(row));
  }

  workflowClass(row: ProformaRequestRow): string {
    return workflowBadgeClass(this.workflowOf(row));
  }

  codeOf(row: ProformaRequestRow): string {
    return requestCode(row);
  }

  clientLabel(row: ProformaRequestRow): string {
    return row.client_detail?.name?.trim() || `Cliente #${row.client}`;
  }

  assigneeLabel(row: ProformaRequestRow): string {
    if (!row.assigned_user) return 'Sin asignar';
    return userDisplayName(row.assigned_user_detail, row.assigned_user);
  }

  typeText(row: ProformaRequestRow): string {
    const labels: Record<ProformaRequestType, string> = {
      MAQUINARIA: 'Maquinaria',
      REPUESTOS: 'Repuestos',
      SERVICIOS: 'Servicios',
      ALQUILERES: 'Alquileres',
    };
    return labels[row.proforma_type];
  }

  channelText(row: ProformaRequestRow): string {
    const labels: Record<ProformaEntryChannel, string> = {
      META: 'Meta',
      GOOGLE_ADS: 'Google Ads',
      WHATSAPP: 'WhatsApp',
      EMAIL: 'Email',
    };
    return labels[row.entry_channel];
  }

  priorityText(row: ProformaRequestRow): string {
    return priorityLabel(row.priority);
  }

  isOverdue(row: ProformaRequestRow): boolean {
    return dueIsOverdue(row.due_at, this.workflowOf(row));
  }

  private reportDateMs(row: ProformaRequestRow): number {
    const iso = row.entered_at || row.updated_at;
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
}
