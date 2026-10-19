import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { AuthService } from '../../../../core/services/auth.service';
import { CompanyService } from '../../../admin/services/company.service';
import type { Product, Warehouse } from '../../../almacen/models/almacen.models';
import { ProductService } from '../../../almacen/services/product.service';
import { WarehouseService } from '../../../almacen/services/warehouse.service';
import type { Supplier } from '../../../core/models/supplier.model';
import { SupplierService } from '../../../core/services/supplier.service';
import type { PaymentMethodRow } from '../../../ventas/models/ventas.models';
import { PaymentMethodService } from '../../../ventas/services/payment-method.service';
import {
  PURCHASE_ORDER_STATUSES,
  enrichPurchaseOrderItems,
  formatIsoDate,
  formatPurchaseMoney,
  formatWarehouseLabel,
  purchaseOrderStatusBadge,
  purchaseOrderStatusLabel,
  resolvePurchaseOrderTotals,
  type PurchaseOrder,
  type PurchaseOrderMoney,
  type PurchaseOrderStatus,
} from '../../models/purchase-order.models';
import { PurchaseOrderItemService } from '../../services/purchase-order-item.service';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { openPurchaseOrderPdf } from '../../utils/purchase-order-pdf.util';

@Component({
  selector: 'app-purchase-orders-page',
  imports: [RouterLink],
  templateUrl: './purchase-orders-page.component.html',
})
export class PurchaseOrdersPageComponent implements OnInit {
  private readonly ordersApi = inject(PurchaseOrderService);
  private readonly itemsApi = inject(PurchaseOrderItemService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly warehousesApi = inject(WarehouseService);
  private readonly paymentsApi = inject(PaymentMethodService);
  private readonly productsApi = inject(ProductService);
  private readonly companyApi = inject(CompanyService);
  private readonly http = inject(HttpClient);
  readonly auth = inject(AuthService);

  readonly statuses = PURCHASE_ORDER_STATUSES;
  readonly orders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly paymentMethods = signal<PaymentMethodRow[]>([]);
  readonly loading = signal(true);
  readonly listLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pdfBusyId = signal<number | null>(null);

  readonly filterSupplier = signal<number | null>(null);
  readonly filterStatus = signal<PurchaseOrderStatus | ''>('');
  readonly searchQuery = signal('');
  readonly supplierQuery = signal('');
  readonly supplierMenuOpen = signal(false);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly supplierMatches = computed(() => {
    const query = this.supplierQuery().trim();
    const selected = this.suppliers().find((supplier) => supplier.id === this.filterSupplier());
    const selectedLabel = selected ? this.supplierChoiceLabel(selected) : '';
    return this.suppliers()
      .filter((supplier) => {
        const text = query.trim();
        if (!text || text === selectedLabel) return true;
        return textMatchesLooseQuery(`${supplier.name} ${supplier.ruc}`, text);
      })
      .slice(0, 20);
  });

  readonly supplierName = computed(() => {
    const names = new Map<number, string>();
    for (const supplier of this.suppliers()) names.set(supplier.id, supplier.name);
    return names;
  });

  readonly filteredOrders = computed(() => {
    const query = this.searchQuery().trim();
    const rows = this.orders();
    if (!query) return rows;
    return rows.filter((row) => {
      const supplier = this.suppliers().find((item) => item.id === row.supplier);
      const haystack = [
        row.correlativo,
        row.supplier_reference,
        String(row.id),
        row.money,
        purchaseOrderStatusLabel(row.status),
        supplier?.name ?? '',
        supplier?.ruc ?? '',
        formatIsoDate(row.expected_delivery_date),
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
      this.filterSupplier() != null || this.filterStatus() !== '' || this.searchQuery().trim() !== '',
  );

  ngOnInit(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      orders: this.ordersApi.list(),
      suppliers: this.suppliersApi.list(),
      warehouses: this.warehousesApi.list(),
      payments: this.paymentsApi.list(),
    }).subscribe({
      next: ({ orders, suppliers, warehouses, payments }) => {
        this.orders.set(orders);
        this.suppliers.set([...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'es')));
        this.warehouses.set(warehouses);
        this.paymentMethods.set(payments);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  onSupplierQuery(value: string): void {
    this.supplierQuery.set(value);
    this.supplierMenuOpen.set(true);
    const selected = this.suppliers().find((supplier) => supplier.id === this.filterSupplier());
    const label = selected ? this.supplierChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.filterSupplier.set(null);
      this.reloadOrders();
    }
  }

  closeSupplierMenuSoon(): void {
    window.setTimeout(() => this.supplierMenuOpen.set(false), 180);
  }

  pickSupplierFilter(supplier: Supplier | null, event?: Event): void {
    event?.preventDefault();
    this.supplierMenuOpen.set(false);
    if (!supplier) {
      this.supplierQuery.set('');
      this.filterSupplier.set(null);
    } else {
      this.supplierQuery.set(this.supplierChoiceLabel(supplier));
      this.filterSupplier.set(supplier.id);
    }
    this.reloadOrders();
  }

  onStatusFilter(value: string): void {
    this.filterStatus.set(value as PurchaseOrderStatus | '');
    this.reloadOrders();
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  clearFilters(): void {
    this.filterSupplier.set(null);
    this.filterStatus.set('');
    this.searchQuery.set('');
    this.supplierQuery.set('');
    this.pageIndex.set(0);
    this.reloadOrders();
  }

  setPageSize(size: number): void {
    if (!this.pageSizeOptions.includes(size as (typeof this.pageSizeOptions)[number])) return;
    this.pageSize.set(size);
    this.pageIndex.set(0);
  }

  prevPage(): void {
    this.pageIndex.update((index) => Math.max(0, index - 1));
  }

  nextPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    this.pageIndex.update((index) => Math.min(last, index + 1));
  }

  reloadOrders(): void {
    this.listLoading.set(true);
    this.errorMessage.set(null);
    this.pageIndex.set(0);
    this.ordersApi
      .list({
        supplier: this.filterSupplier(),
        status: this.filterStatus() || null,
      })
      .subscribe({
        next: (orders) => {
          this.orders.set(orders);
          this.listLoading.set(false);
          this.loading.set(false);
        },
        error: (err) => {
          this.listLoading.set(false);
          this.loading.set(false);
          this.errorMessage.set(formatHttpError(err));
        },
      });
  }

  async generateOc(row: PurchaseOrder): Promise<void> {
    this.pdfBusyId.set(row.id);
    this.errorMessage.set(null);
    try {
      const { order, items, products } = await firstValueFrom(
        forkJoin({
          order: this.ordersApi.retrieve(row.id),
          items: this.itemsApi.list(row.id),
          products: this.productsApi.list().pipe(catchError(() => of([] as Product[]))),
        }),
      );
      const lines = enrichPurchaseOrderItems(
        items.length ? items : (order.items ?? []),
        products,
      );
      if (!lines.length) {
        this.errorMessage.set('La orden no tiene líneas. Ábrela y agrega productos antes de generar la OC.');
        return;
      }
      const supplier = this.suppliers().find((s) => s.id === order.supplier) ?? null;
      const warehouse = this.warehouses().find((w) => w.id === order.warehouse) ?? null;
      const payment = this.paymentMethods().find((p) => p.id === order.payment_methods);
      const totals = resolvePurchaseOrderTotals(order, lines, order.discount, order.tax, order.total != null);
      await openPurchaseOrderPdf({
        http: this.http,
        companyApi: this.companyApi,
        companyId: this.auth.me()?.profile?.company?.id ?? order.company,
        companyName: this.companyTitle(),
        fallbackLogoUrl: this.auth.me()?.profile?.company?.logo_url ?? null,
        order,
        lines,
        supplier,
        warehouseLabel: warehouse
          ? formatWarehouseLabel(warehouse, this.supplierName().get(warehouse.supplier))
          : '—',
        paymentMethodName: payment?.name ?? (order.payment_methods ? `#${order.payment_methods}` : '—'),
        totals,
      });
    } catch (err) {
      this.errorMessage.set(formatHttpError(err));
    } finally {
      this.pdfBusyId.set(null);
    }
  }

  remove(row: PurchaseOrder): void {
    const label = row.correlativo || `#${row.id}`;
    if (!window.confirm(`¿Eliminar la orden de compra ${label}?`)) return;
    this.errorMessage.set(null);
    this.ordersApi.delete(row.id).subscribe({
      next: () => this.reloadOrders(),
      error: (err) => this.errorMessage.set(formatHttpError(err)),
    });
  }

  supplierLabel(id: number): string {
    return this.supplierName().get(id) ?? (id ? `Proveedor #${id}` : '—');
  }

  statusLabel(status: string): string {
    return purchaseOrderStatusLabel(status);
  }

  statusBadge(status: string): string {
    return purchaseOrderStatusBadge(status);
  }

  money(amount: string | null, currency: PurchaseOrderMoney): string {
    return formatPurchaseMoney(amount, currency);
  }

  delivery(iso: string | null): string {
    return formatIsoDate(iso);
  }

  orderCode(row: PurchaseOrder): string {
    return row.correlativo || `#${row.id}`;
  }

  companyTitle(): string {
    const name = this.auth.companyName();
    return name === '—' ? '' : name;
  }

  private supplierChoiceLabel(supplier: Supplier): string {
    const ruc = supplier.ruc?.trim();
    return ruc ? `${supplier.name} · ${ruc}` : supplier.name;
  }
}
