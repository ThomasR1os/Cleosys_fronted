import { Component, input } from '@angular/core';

@Component({
  selector: 'app-kpi-card',
  template: `
    <div class="card bg-base-100 shadow-md">
      <div class="card-body gap-1 p-4">
        <p class="text-base-content/60 text-sm font-medium">{{ title() }}</p>
        <p class="text-2xl font-bold tracking-tight" [class]="valueClass()">{{ value() }}</p>
        @if (subtitle()) {
          <p class="text-base-content/50 text-xs">{{ subtitle() }}</p>
        }
        @if (trend()) {
          <p class="text-xs" [class]="trendClass()">{{ trend() }}</p>
        }
      </div>
    </div>
  `,
})
export class KpiCardComponent {
  readonly title = input.required<string>();
  readonly value = input.required<string>();
  readonly subtitle = input<string>('');
  readonly trend = input<string>('');
  readonly variant = input<'default' | 'success' | 'warning' | 'error' | 'info'>('default');

  valueClass(): string {
    switch (this.variant()) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'error':
        return 'text-error';
      case 'info':
        return 'text-info';
      default:
        return 'text-base-content';
    }
  }

  trendClass(): string {
    switch (this.variant()) {
      case 'success':
        return 'text-success/80';
      case 'warning':
        return 'text-warning/80';
      case 'error':
        return 'text-error/80';
      case 'info':
        return 'text-info/80';
      default:
        return 'text-base-content/60';
    }
  }
}
