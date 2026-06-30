import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import {
  Chart,
  type ChartConfiguration,
  type ChartType,
  registerables,
} from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard-chart',
  template: `<div class="relative h-full min-h-[220px] w-full"><canvas #canvas></canvas></div>`,
})
export class DashboardChartComponent implements OnDestroy {
  readonly config = input.required<ChartConfiguration>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  constructor() {
    effect(() => {
      const cfg = this.config();
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas || !cfg) return;

      if (this.chart) {
        this.chart.destroy();
      }

      this.chart = new Chart(canvas, {
        ...cfg,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...cfg.options,
        },
      });
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}

export type { ChartConfiguration, ChartType };
