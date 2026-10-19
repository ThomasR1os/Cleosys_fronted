import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { AuthService } from '../../../../core/services/auth.service';
import type { TaskRow, TaskSummary } from '../../models/task.models';
import { TaskService } from '../../services/task.service';
import { queueLabel, userDisplayName, waitingOnLabel } from '../../../ventas/utils/proforma-workflow.utils';

@Component({
  selector: 'app-tasks-inbox-page',
  imports: [RouterLink],
  templateUrl: './tasks-inbox-page.component.html',
})
export class TasksInboxPageComponent implements OnInit {
  private readonly api = inject(TaskService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly items = signal<TaskRow[]>([]);
  readonly summary = signal<TaskSummary | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly tab = signal<'mine' | 'unassigned' | 'all'>('mine');

  readonly filtered = computed(() => this.items());
  readonly backLink = computed(() =>
    this.auth.me()?.profile?.role === 'LOGISTICA' ? '/logistica' : '/ventas',
  );

  ngOnInit(): void {
    this.reload();
  }

  setTab(tab: 'mine' | 'unassigned' | 'all'): void {
    this.tab.set(tab);
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    const tab = this.tab();
    this.api.list(tab === 'all' ? {} : tab === 'mine' ? { mine: true } : { unassigned: true }).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
    this.api.summary().subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
  }

  take(row: TaskRow): void {
    this.api.take(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  open(row: TaskRow): void {
    if (row.proforma_request) {
      const role = this.auth.me()?.profile?.role;
      const base = role === 'LOGISTICA' ? '/logistica/solicitudes-proforma' : '/ventas/solicitudes-proforma';
      void this.router.navigate([base], { queryParams: { detalle: row.proforma_request } });
      return;
    }
  }

  formatStamp(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }

  assignee(row: TaskRow): string {
    return userDisplayName(row.assigned_user_detail, row.assigned_user);
  }

  queue(row: TaskRow): string {
    return queueLabel(row.queue);
  }

  waiting(row: TaskRow): string {
    return waitingOnLabel(row.waiting_on);
  }

  statusLabel(status: TaskRow['status']): string {
    const labels = {
      PENDING: 'Pendiente',
      IN_PROGRESS: 'En curso',
      WAITING: 'En espera',
      COMPLETED: 'Completada',
      CANCELLED: 'Cancelada',
      NOT_POSSIBLE: 'No posible',
    };
    return status ? labels[status] : '—';
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) return formatHttpError(err);
    return formatHttpError(err);
  }
}
