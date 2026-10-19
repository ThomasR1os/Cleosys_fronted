import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { AuthService } from '../../../../core/services/auth.service';
import type { ClientRow } from '../../../ventas/models/ventas.models';
import { ClientService } from '../../../ventas/services/client.service';
import {
  LOGISTICS_ORDER_STATUSES,
  formatQty,
  logisticsOrderStatusBadge,
  logisticsOrderStatusLabel,
  sumPendingQty,
  type LogisticsOrder,
  type LogisticsOrderStatus,
} from '../../models/logistics-order.models';
import { LogisticsOrderItemService } from '../../services/logistics-order-item.service';
import { LogisticsOrderService } from '../../services/logistics-order.service';

@Component({
  selector: 'app-logistics-orders-page',
  imports: [RouterLink],
  templateUrl: './logistics-orders-page.component.html',
})
export class LogisticsOrdersPageComponent implements OnInit {
  private readonly ordersApi = inject(LogisticsOrderService);
  private readonly itemsApi = inject(LogisticsOrderItemService);
  private readonly clientsApi = inject(ClientService);
  readonly auth = inject(AuthService);

  readonly statuses = LOGISTICS_ORDER_STATUSES;
  readonly orders = signal<LogisticsOrder[]>([]);
  readonly clients = signal<ClientRow[]>([]);
  readonly pendingByOrder = signal<Record<number, number>>({});
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly filterStatus = signal<LogisticsOrderStatus | ''>('PENDIENTE');
  readonly filterQuotation = signal('');
  readonly filterClient = signal<number | null>(null);
  readonly searchQuery = signal('');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly clientNameById = computed(() => {
    const names = new Map<number, string>();
    for (const client of this.clients()) names.set(client.id, client.name);
    return names;
  });

  readonly filteredOrders = computed(() => {
    const query = this.searchQuery().trim();
    const rows = this.orders();
    if (!query) return rows;
    return rows.filter((row) => {
      const haystack = [
        String(row.id),
        row.quotation_correlativo ?? '',
        row.quotation != null ? String(row.quotation) : '',
        this.clientLabel(row),
        logisticsOrderStatusLabel(row.status),
        row.notes,
      ].join(' ');
      return textMatchesLooseQuery(haystack, query);
    });
  });

  readonly totalCount = computed(() => this.filteredOrders().length);
  readonly totalPages = computed(() => {
    const count = this.totalCount();
    if (count === 0) return 0;
    return Math.ceil(count / this.pageSize());
  });
  readonly pagedOrders = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredOrders().slice(start, start + this.pageSize());
  });
  readonly rangeStart = computed(() => (this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1));
  readonly rangeEnd = computed(() => Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()));
  readonly hasFilters = computed(
    () =>
      this.filterStatus() !== 'PENDIENTE' ||
      this.filterQuotation().trim() !== '' ||
      this.filterClient() != null ||
      this.searchQuery().trim() !== '',
  );

  ngOnInit(): void {
    this.clientsApi.listForCompany().subscribe({
      next: (rows) => this.clients.set([...rows].sort((a, b) => a.name.localeCompare(b.name, 'es'))),
      error: () => this.clients.set([]),
    });
    this.reload();
  }

  companyTitle(): string {
    const name = this.auth.companyName();
    return name === '—' ? '' : name;
  }

  clientLabel(row: LogisticsOrder): string {
    if (row.client_name) return row.client_name;
    if (row.client != null) return this.clientNameById().get(row.client) ?? `Cliente #${row.client}`;
    return '—';
  }

  quotationLabel(row: LogisticsOrder): string {
    if (row.quotation_correlativo) return row.quotation_correlativo;
    if (row.quotation != null) return `#${row.quotation}`;
    return '—';
  }

  statusLabel(status: string): string {
    return logisticsOrderStatusLabel(status);
  }

  statusBadge(status: string): string {
    return logisticsOrderStatusBadge(status);
  }

  pendingLabel(orderId: number): string {
    const value = this.pendingByOrder()[orderId];
    if (value == null) return '—';
    return formatQty(value);
  }

  onStatusFilter(value: string): void {
    this.filterStatus.set(value as LogisticsOrderStatus | '');
    this.pageIndex.set(0);
    this.reload();
  }

  onQuotationFilter(value: string): void {
    this.filterQuotation.set(value);
    this.pageIndex.set(0);
    this.reload();
  }

  onClientFilter(value: string): void {
    const id = Number(value);
    this.filterClient.set(Number.isFinite(id) && id > 0 ? id : null);
    this.pageIndex.set(0);
    this.reload();
  }

  onSearch(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  clearFilters(): void {
    this.filterStatus.set('PENDIENTE');
    this.filterQuotation.set('');
    this.filterClient.set(null);
    this.searchQuery.set('');
    this.pageIndex.set(0);
    this.reload();
  }

  setPageSize(size: number): void {
    if (size !== 10 && size !== 25 && size !== 50) return;
    this.pageSize.set(size);
    this.pageIndex.set(0);
  }

  prevPage(): void {
    this.pageIndex.update((page) => Math.max(0, page - 1));
  }

  nextPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    this.pageIndex.update((page) => Math.min(last, page + 1));
  }

  private reload(): void {
    const quotation = Number(this.filterQuotation().trim());
    this.loading.set(this.orders().length === 0);
    this.errorMessage.set(null);
    this.ordersApi
      .list({
        status: this.filterStatus() || null,
        quotation: Number.isFinite(quotation) && quotation > 0 ? quotation : null,
        client: this.filterClient(),
      })
      .subscribe({
        next: (orders) => {
          this.orders.set(orders);
          this.clampPage();
          this.loading.set(false);
          this.loadPending(orders);
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(formatHttpError(err));
        },
      });
  }

  private loadPending(orders: LogisticsOrder[]): void {
    if (!orders.length) {
      this.pendingByOrder.set({});
      return;
    }
    if (orders.every((order) => order.items != null)) {
      const embedded: Record<number, number> = {};
      for (const order of orders) embedded[order.id] = sumPendingQty(order.items ?? []);
      this.pendingByOrder.set(embedded);
      return;
    }
    forkJoin(
      orders.map((order) =>
        this.itemsApi.list(order.id).pipe(
          map((items) => [order.id, sumPendingQty(items)] as const),
          catchError(() => of([order.id, 0] as const)),
        ),
      ),
    ).subscribe({
      next: (pairs) => {
        const map: Record<number, number> = {};
        for (const [id, pending] of pairs) map[id] = pending;
        this.pendingByOrder.set(map);
      },
      error: () => undefined,
    });
  }

  private clampPage(): void {
    const pages = this.totalPages();
    if (pages === 0) {
      this.pageIndex.set(0);
      return;
    }
    if (this.pageIndex() >= pages) this.pageIndex.set(pages - 1);
  }
}
