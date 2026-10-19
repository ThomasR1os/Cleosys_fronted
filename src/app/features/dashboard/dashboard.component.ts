import { NgClass } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ShortDateTimePipe } from '../../core/pipes/short-datetime.pipe';
import { AuthService } from '../../core/services/auth.service';
import type {
  QuotationMoney,
  QuotationRow,
  QuotationStatus,
  QuotationType,
} from '../ventas/models/ventas.models';
import { DashboardChartComponent } from './components/dashboard-chart.component';
import { KpiCardComponent } from './components/kpi-card.component';
import { ProformaDashboardComponent } from './components/proforma-dashboard.component';
import type { DashboardFilters, DashboardStats } from './models/dashboard.models';
import { DashboardStatsService } from './services/dashboard-stats.service';

const CHART_COLORS = {
  primary: 'rgba(59, 130, 246, 0.85)',
  primaryLight: 'rgba(59, 130, 246, 0.15)',
  success: 'rgba(34, 197, 94, 0.85)',
  warning: 'rgba(234, 179, 8, 0.85)',
  error: 'rgba(239, 68, 68, 0.85)',
  info: 'rgba(14, 165, 233, 0.85)',
  secondary: 'rgba(168, 85, 247, 0.85)',
  accent: 'rgba(244, 114, 182, 0.85)',
};

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

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    NgClass,
    FormsModule,
    KpiCardComponent,
    DashboardChartComponent,
    ProformaDashboardComponent,
    ShortDateTimePipe,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly statsService = inject(DashboardStatsService);

  readonly months = MONTHS;

  readonly report = signal<'quotations' | 'proformas'>('quotations');

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly stats = signal<DashboardStats | null>(null);

  private readonly now = new Date();
  readonly filterYear = signal(this.now.getFullYear());
  readonly filterMonth = signal<number | 'ALL'>(this.now.getMonth() + 1);
  readonly filterStatus = signal<'ALL' | QuotationStatus>('APROBADA');
  readonly filterType = signal<'ALL' | QuotationType>('ALL');
  readonly filterMoney = signal<'ALL' | QuotationMoney>('ALL');
  readonly filterAdvisor = signal<number | 'ALL'>('ALL');
  readonly amountChartMoney = signal<'PEN' | 'USD'>('PEN');

  readonly filters = computed((): DashboardFilters => ({
    year: this.filterYear(),
    month: this.filterMonth(),
    status: this.filterStatus(),
    quotationType: this.filterType(),
    money: this.filterMoney(),
    advisorId: this.filterAdvisor(),
  }));

  readonly kpis = computed(() => this.stats()?.kpis ?? null);

  readonly periodLabel = computed(() => {
    const year = this.filterYear();
    const month = this.filterMonth();
    if (month === 'ALL') return `en ${year}`;
    const name = MONTHS.find((m) => m.value === month)?.label ?? '';
    return `en ${name} ${year}`;
  });

  readonly hasMonthlyRows = computed(() =>
    (this.stats()?.timeSeries ?? []).some((row) => row.count > 0),
  );

  readonly sortedQuotations = computed(() => {
    const rows = [...(this.stats()?.filtered ?? [])];
    return rows.sort((a, b) => {
      const da = this.reportDateMs(a);
      const db = this.reportDateMs(b);
      return db - da;
    });
  });

  readonly trendChartConfig = computed((): ChartConfiguration => {
    const series = this.stats()?.timeSeries ?? [];
    const money = this.amountChartMoney();
    const amounts = series.map((b) => (money === 'PEN' ? b.amountPen : b.amountUsd));

    return {
      type: 'bar',
      data: {
        labels: series.map((b) => b.label),
        datasets: [
          {
            type: 'bar',
            label: 'Cotizaciones',
            data: series.map((b) => b.count),
            backgroundColor: CHART_COLORS.primary,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: `Monto (${money})`,
            data: amounts,
            borderColor: CHART_COLORS.success,
            backgroundColor: CHART_COLORS.primaryLight,
            tension: 0.3,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Cantidad' },
            ticks: { stepSize: 1 },
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: `Monto ${money}` },
          },
        },
      },
    };
  });

  readonly statusChartConfig = computed((): ChartConfiguration => {
    const buckets = this.stats()?.byStatus ?? [];
    return {
      type: 'doughnut',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          {
            data: buckets.map((b) => b.count),
            backgroundColor: [CHART_COLORS.success, CHART_COLORS.warning, CHART_COLORS.error],
            borderWidth: 0,
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: 'bottom' },
        },
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
            label: 'Cotizaciones',
            data: buckets.map((b) => b.count),
            backgroundColor: [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.info],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1 } },
        },
      },
    };
  });

  readonly advisorChartConfig = computed((): ChartConfiguration => {
    const advisors = (this.stats()?.byAdvisor ?? []).slice(0, 8);
    return {
      type: 'bar',
      data: {
        labels: advisors.map((a) => a.label),
        datasets: [
          {
            label: 'Cotizaciones',
            data: advisors.map((a) => a.count),
            backgroundColor: CHART_COLORS.accent,
            borderRadius: 4,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
        },
      },
    };
  });

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.statsService.loadStats(this.filters(), { force: true }).subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las estadísticas de cotizaciones.');
        this.loading.set(false);
      },
    });
  }

  onFiltersChange(): void {
    this.statsService.loadStats(this.filters()).subscribe({
      next: (data) => this.stats.set(data),
      error: () => this.error.set('No se pudieron cargar las estadísticas de cotizaciones.'),
    });
  }

  onYearChange(value: number | string): void {
    this.filterYear.set(Number(value));
    this.onFiltersChange();
  }

  onMonthChange(value: number | 'ALL' | string): void {
    this.filterMonth.set(value === 'ALL' ? 'ALL' : Number(value));
    this.onFiltersChange();
  }

  formatMoney(amount: number, currency: 'PEN' | 'USD'): string {
    const symbol = currency === 'PEN' ? 'S/' : 'US$';
    return `${symbol} ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  formatPercent(value: number): string {
    return `${value.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`;
  }

  statusChangedAt(row: QuotationRow): string | null | undefined {
    return row.approved_at || row.update_date;
  }

  advisorLabel(row: QuotationRow): string {
    return (
      row.user_detail?.nombre?.trim() ||
      [row.user_detail?.first_name, row.user_detail?.last_name].filter(Boolean).join(' ') ||
      row.user_detail?.username ||
      `Usuario #${row.user}`
    );
  }

  clientLabel(row: QuotationRow): string {
    return row.client_detail?.name?.trim() || `Cliente #${row.client}`;
  }

  rowAmount(row: QuotationRow): string {
    const n = Number.parseFloat(String(row.final_price ?? 0));
    return this.formatMoney(Number.isFinite(n) ? n : 0, row.money);
  }

  private reportDateMs(row: QuotationRow): number {
    const iso = row.approved_at || row.update_date || row.creation_date;
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
}
