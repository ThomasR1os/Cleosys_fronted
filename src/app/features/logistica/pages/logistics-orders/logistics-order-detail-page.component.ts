import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { AuthService } from '../../../../core/services/auth.service';
import {
  LOGISTICS_PURCHASE_STATE,
  formatQty,
  logisticsItemLabel,
  logisticsOrderStatusBadge,
  logisticsOrderStatusLabel,
  type LogisticsOrder,
  type LogisticsOrderItem,
  type LogisticsPurchaseDraft,
} from '../../models/logistics-order.models';
import { LogisticsOrderItemService } from '../../services/logistics-order-item.service';
import { LogisticsOrderService } from '../../services/logistics-order.service';

@Component({
  selector: 'app-logistics-order-detail-page',
  imports: [RouterLink],
  templateUrl: './logistics-order-detail-page.component.html',
})
export class LogisticsOrderDetailPageComponent implements OnInit {
  private readonly ordersApi = inject(LogisticsOrderService);
  private readonly itemsApi = inject(LogisticsOrderItemService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly order = signal<LogisticsOrder | null>(null);
  readonly items = signal<LogisticsOrderItem[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly closeOpen = signal(false);
  readonly closeNotes = signal('Salió de stock');

  readonly hasPending = computed(() => this.items().some((item) => Number(item.pending_qty) > 0));
  readonly canClose = computed(() => {
    const status = this.order()?.status;
    return this.auth.canWriteLogistica() && (status === 'PENDIENTE' || status === 'PARCIAL');
  });
  readonly canPurchase = computed(
    () => this.auth.canWriteLogistica() && this.hasPending() && this.order()?.status !== 'CERRADA',
  );

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      this.loading.set(false);
      this.errorMessage.set('Orden interna no válida.');
      return;
    }
    this.load(id);
  }

  statusLabel(status: string): string {
    return logisticsOrderStatusLabel(status);
  }

  statusBadge(status: string): string {
    return logisticsOrderStatusBadge(status);
  }

  itemLabel(item: LogisticsOrderItem): string {
    return logisticsItemLabel(item);
  }

  qty(value: string): string {
    return formatQty(value);
  }

  clientLabel(row: LogisticsOrder): string {
    if (row.client_name) return row.client_name;
    if (row.client != null) return `Cliente #${row.client}`;
    return '—';
  }

  quotationLabel(row: LogisticsOrder): string {
    if (row.quotation_correlativo) return row.quotation_correlativo;
    if (row.quotation != null) return `#${row.quotation}`;
    return '—';
  }

  openClose(): void {
    this.closeNotes.set('Salió de stock');
    this.closeOpen.set(true);
    this.errorMessage.set(null);
  }

  closeClose(): void {
    if (this.saving()) return;
    this.closeOpen.set(false);
  }

  onCloseNotes(value: string): void {
    this.closeNotes.set(value);
  }

  confirmClose(): void {
    const order = this.order();
    if (!order || !this.canClose() || this.saving()) return;
    const notes = this.closeNotes().trim();
    if (!notes) {
      this.errorMessage.set('Indica por qué se cierra la orden.');
      return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);
    this.ordersApi.update(order.id, { status: 'CERRADA', notes }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.closeOpen.set(false);
        this.order.set(updated);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  generatePurchase(): void {
    const order = this.order();
    if (!order || !this.canPurchase()) return;
    const lines = this.items()
      .filter((item) => Number(item.pending_qty) > 0)
      .map((item) => ({
        logistics_order_item: item.id,
        product: item.product,
        cant: item.pending_qty,
        sku: item.product_sku,
        description: item.product_description,
      }));
    if (!lines.length) return;
    const draft: LogisticsPurchaseDraft = { logisticsOrderId: order.id, lines };
    void this.router.navigate(['/logistica/ordenes-compra/nueva'], {
      state: { [LOGISTICS_PURCHASE_STATE]: draft },
    });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      order: this.ordersApi.retrieve(id),
      items: this.itemsApi.list(id),
    }).subscribe({
      next: ({ order, items }) => {
        this.order.set(order);
        this.items.set(items);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }
}
