import { NgClass } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { AuthService } from '../../core/services/auth.service';
import type {
  QuotationMoney,
  QuotationStatus,
  QuotationType,
} from '../ventas/models/ventas.models';
import { DashboardChartComponent } from './components/dashboard-chart.component';
import { KpiCardComponent } from './components/kpi-card.component';
import type {
  DashboardDatePreset,
  DashboardFilters,
  DashboardStats,
  ReportGrouping,
} from './models/dashboard.models';
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

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    NgClass,
    FormsModule,
    KpiCardComponent,
    DashboardChartComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly statsService = inject(DashboardStatsService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly stats = signal<DashboardStats | null>(null);

  readonly grouping = signal<ReportGrouping>('month');
  readonly datePreset = signal<DashboardDatePreset>('thisYear');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly filterStatus = signal<'ALL' | QuotationStatus>('ALL');
  readonly filterType = signal<'ALL' | QuotationType>('ALL');
  readonly filterMoney = signal<'ALL' | QuotationMoney>('ALL');
  readonly filterAdvisor = signal<number | 'ALL'>('ALL');
  readonly amountChartMoney = signal<'PEN' | 'USD'>('PEN');

  readonly filters = computed((): DashboardFilters => ({
    grouping: this.grouping(),
    datePreset: this.datePreset(),
    dateFrom: this.dateFrom(),
    dateTo: this.dateTo(),
    status: this.filterStatus(),
    quotationType: this.filterType(),
    money: this.filterMoney(),
    advisorId: this.filterAdvisor(),
  }));

  readonly kpis = computed(() => this.stats()?.kpis ?? null);

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

  readonly groupingLabel = computed(() => {
    switch (this.grouping()) {
      case 'day':
        return 'por día';
      case 'month':
        return 'por mes';
      case 'year':
        return 'por año';
    }
  });

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.statsService.loadStats(this.filters()).subscribe({
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
    this.reload();
  }

  setGrouping(value: ReportGrouping): void {
    this.grouping.set(value);
    this.onFiltersChange();
  }

  setDatePreset(value: DashboardDatePreset): void {
    this.datePreset.set(value);
    if (value !== 'custom') {
      this.dateFrom.set('');
      this.dateTo.set('');
    }
    this.onFiltersChange();
  }

  formatMoney(amount: number, currency: 'PEN' | 'USD'): string {
    const symbol = currency === 'PEN' ? 'S/' : 'US$';
    return `${symbol} ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  formatPercent(value: number): string {
    return `${value.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`;
  }
}
