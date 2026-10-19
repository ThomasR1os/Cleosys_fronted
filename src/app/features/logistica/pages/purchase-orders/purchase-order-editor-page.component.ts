import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
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
import type { ProductSupplierRow } from '../../models/logistica.models';
import { readLogisticsPurchaseDraft } from '../../models/logistics-order.models';
import {
  PURCHASE_ORDER_STATUSES,
  formatPurchaseMoney,
  formatWarehouseLabel,
  lineAmount,
  purchaseOrderProductLabel,
  purchaseOrderStatusBadge,
  purchaseOrderStatusLabel,
  receivedExceedsOrdered,
  resolvePurchaseOrderTotals,
  toDecimalString,
  type PurchaseOrder,
  type PurchaseOrderCreateItem,
  type PurchaseOrderItem,
  type PurchaseOrderMoney,
  type PurchaseOrderStatus,
  type PurchaseOrderTotals,
  type PurchaseOrderWrite,
} from '../../models/purchase-order.models';
import { ProductSupplierService } from '../../services/product-supplier.service';
import { PurchaseOrderItemService } from '../../services/purchase-order-item.service';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { openPurchaseOrderPdf } from '../../utils/purchase-order-pdf.util';

interface EditorLine {
  key: string;
  id: number | null;
  product: number;
  product_sku: string;
  product_description: string;
  cant: string;
  unit_cost: string;
  received_qty: string;
  /** Línea de orden interna que cubre esta compra. */
  logistics_order_item: number | null;
  /** Tope de cantidad: lo pendiente de esa línea interna. */
  max_cant: string | null;
}

@Component({
  selector: 'app-purchase-order-editor-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './purchase-order-editor-page.component.html',
})
export class PurchaseOrderEditorPageComponent implements OnInit {
  private readonly ordersApi = inject(PurchaseOrderService);
  private readonly itemsApi = inject(PurchaseOrderItemService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly productsApi = inject(ProductService);
  private readonly warehousesApi = inject(WarehouseService);
  private readonly paymentsApi = inject(PaymentMethodService);
  private readonly productSuppliersApi = inject(ProductSupplierService);
  private readonly companyApi = inject(CompanyService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly statuses = PURCHASE_ORDER_STATUSES;
  readonly moneyOptions: PurchaseOrderMoney[] = ['USD', 'PEN'];

  readonly isNew = signal(true);
  readonly orderId = signal<number | null>(null);
  /** Orden interna cuyas líneas pendientes se están comprando. */
  readonly coveringLogisticsOrderId = signal<number | null>(null);
  readonly order = signal<PurchaseOrder | null>(null);
  readonly lines = signal<EditorLine[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly paymentMethods = signal<PaymentMethodRow[]>([]);
  readonly productSuppliers = signal<ProductSupplierRow[]>([]);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly lineSaving = signal(false);
  readonly pdfBusy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly editingLineKey = signal<string | null>(null);
  readonly productQuery = signal('');
  readonly productMenuOpen = signal(false);
  readonly selectedProduct = signal<Product | null>(null);
  readonly costHint = signal<string | null>(null);
  readonly supplierQuery = signal('');
  readonly supplierMenuOpen = signal(false);
  readonly paymentQuery = signal('');
  readonly paymentMenuOpen = signal(false);
  readonly warehouseQuery = signal('');
  readonly warehouseMenuOpen = signal(false);
  private readonly supplierId = signal(0);
  private readonly paymentId = signal(0);
  private readonly warehouseId = signal(0);
  readonly totals = signal<PurchaseOrderTotals>(resolvePurchaseOrderTotals(null, [], 0, 18, false));

  readonly form = this.fb.nonNullable.group({
    supplier: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    money: this.fb.nonNullable.control<PurchaseOrderMoney>('USD', Validators.required),
    payment_methods: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    payment_terms: this.fb.nonNullable.control('', Validators.maxLength(120)),
    incoterm: this.fb.nonNullable.control('', Validators.maxLength(12)),
    expected_delivery_date: this.fb.nonNullable.control(''),
    supplier_reference: this.fb.nonNullable.control('', Validators.maxLength(120)),
    warehouse: this.fb.nonNullable.control(0),
    discount: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0), Validators.max(100)]),
    tax: this.fb.nonNullable.control(18, [Validators.required, Validators.min(0), Validators.max(100)]),
    notes: this.fb.nonNullable.control(''),
    status: this.fb.nonNullable.control<PurchaseOrderStatus>('BORRADOR', Validators.required),
  });

  readonly lineForm = this.fb.nonNullable.group({
    product: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    cant: this.fb.nonNullable.control(1, [Validators.required, Validators.min(0.01)]),
    unit_cost: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0)]),
    received_qty: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0)]),
  });

  readonly editingPersistedLine = computed(() => {
    const key = this.editingLineKey();
    if (!key) return false;
    return this.lines().some((line) => line.key === key && line.id != null);
  });

  readonly editingLinkedLine = computed(() => {
    const key = this.editingLineKey();
    if (!key) return null;
    return this.lines().find((line) => line.key === key && line.logistics_order_item != null) ?? null;
  });

  readonly productMatches = computed(() => {
    const query = this.productQuery().trim();
    const rows = this.products();
    if (!query) return rows.slice(0, 12);
    return rows
      .filter((product) => textMatchesLooseQuery(`${product.sku} ${product.description} ${product.id}`, query))
      .slice(0, 20);
  });

  readonly supplierMatches = computed(() => {
    const selected = this.suppliers().find((supplier) => supplier.id === this.supplierId());
    return this.suppliers()
      .filter((supplier) =>
        this.matchesLookup(
          `${supplier.name} ${supplier.ruc} ${supplier.type === 'EXTRANJERO' ? 'extranjero' : 'nacional'}`,
          this.supplierQuery(),
          selected ? this.supplierChoiceLabel(selected) : '',
        ),
      )
      .slice(0, 20);
  });

  readonly paymentMatches = computed(() => {
    const selected = this.paymentMethods().find((method) => method.id === this.paymentId());
    return this.paymentMethods()
      .filter((method) => this.matchesLookup(method.name, this.paymentQuery(), selected?.name ?? ''))
      .slice(0, 20);
  });

  readonly warehouseMatches = computed(() => {
    const selected = this.warehouseOptions().find((warehouse) => warehouse.id === this.warehouseId());
    return this.warehouseOptions()
      .filter((warehouse) => this.matchesLookup(warehouse.label, this.warehouseQuery(), selected?.label ?? ''))
      .slice(0, 20);
  });

  readonly warehouseOptions = computed(() => {
    const names = new Map(this.suppliers().map((supplier) => [supplier.id, supplier.name]));
    return this.warehouses().map((warehouse) => ({
      id: warehouse.id,
      label: formatWarehouseLabel(warehouse, names.get(warehouse.supplier)),
    }));
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recomputeTotals());
    this.form.controls.supplier.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.supplierId.set(id));
    this.form.controls.payment_methods.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.paymentId.set(id));
    this.form.controls.warehouse.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.warehouseId.set(id));
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam == null) {
      this.isNew.set(true);
      this.orderId.set(null);
    } else {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        this.loading.set(false);
        this.errorMessage.set('Orden no válida.');
        return;
      }
      this.isNew.set(false);
      this.orderId.set(id);
    }
    this.loadCatalogs();
  }

  orderTitle(): string {
    if (this.isNew()) return 'Nueva orden de compra';
    const order = this.order();
    if (!order) return 'Orden de compra';
    return order.correlativo || `Orden #${order.id}`;
  }

  companyTitle(): string {
    const name = this.auth.companyName();
    return name === '—' ? '' : name;
  }

  statusLabel(status: string): string {
    return purchaseOrderStatusLabel(status);
  }

  statusBadge(status: string): string {
    return purchaseOrderStatusBadge(status);
  }

  productLabel(line: EditorLine): string {
    return purchaseOrderProductLabel(line);
  }

  qty(value: string): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  importe(line: EditorLine): string {
    return formatPurchaseMoney(lineAmount(line.cant, line.unit_cost), this.form.controls.money.value);
  }

  unitCost(line: EditorLine): string {
    return formatPurchaseMoney(line.unit_cost, this.form.controls.money.value);
  }

  money(amount: number): string {
    return formatPurchaseMoney(amount, this.form.controls.money.value);
  }

  supplierIsForeign(): boolean {
    const supplier = this.suppliers().find((row) => row.id === this.form.controls.supplier.value);
    return supplier?.type === 'EXTRANJERO';
  }

  onSupplierQuery(value: string): void {
    this.supplierQuery.set(value);
    this.supplierMenuOpen.set(true);
    const current = this.currentSupplier();
    this.clearLookupIfQueryChanged(value, current ? this.supplierChoiceLabel(current) : '', () =>
      this.form.controls.supplier.setValue(0),
    );
  }

  openSupplierMenu(): void {
    this.supplierMenuOpen.set(true);
  }

  closeSupplierMenuSoon(): void {
    window.setTimeout(() => this.supplierMenuOpen.set(false), 180);
  }

  pickSupplier(supplier: Supplier, event?: Event): void {
    event?.preventDefault();
    this.supplierQuery.set(this.supplierChoiceLabel(supplier));
    this.supplierMenuOpen.set(false);
    this.form.controls.supplier.setValue(supplier.id);
    this.form.controls.supplier.markAsDirty();
    this.form.controls.tax.setValue(supplier.type === 'EXTRANJERO' ? 0 : 18);
    this.form.controls.tax.markAsDirty();
  }

  onPaymentQuery(value: string): void {
    this.paymentQuery.set(value);
    this.paymentMenuOpen.set(true);
    const current = this.paymentMethods().find((method) => method.id === this.form.controls.payment_methods.value);
    this.clearLookupIfQueryChanged(value, current?.name ?? '', () => this.form.controls.payment_methods.setValue(0));
  }

  openPaymentMenu(): void {
    this.paymentMenuOpen.set(true);
  }

  closePaymentMenuSoon(): void {
    window.setTimeout(() => this.paymentMenuOpen.set(false), 180);
  }

  pickPayment(method: PaymentMethodRow, event?: Event): void {
    event?.preventDefault();
    this.paymentQuery.set(method.name);
    this.paymentMenuOpen.set(false);
    this.form.controls.payment_methods.setValue(method.id);
    this.form.controls.payment_methods.markAsDirty();
  }

  onWarehouseQuery(value: string): void {
    this.warehouseQuery.set(value);
    this.warehouseMenuOpen.set(true);
    const current = this.warehouseOptions().find((warehouse) => warehouse.id === this.form.controls.warehouse.value);
    this.clearLookupIfQueryChanged(value, current?.label ?? '', () => this.form.controls.warehouse.setValue(0));
  }

  openWarehouseMenu(): void {
    this.warehouseMenuOpen.set(true);
  }

  closeWarehouseMenuSoon(): void {
    window.setTimeout(() => this.warehouseMenuOpen.set(false), 180);
  }

  pickWarehouse(id: number, label: string, event?: Event): void {
    event?.preventDefault();
    this.warehouseQuery.set(id > 0 ? label : '');
    this.warehouseMenuOpen.set(false);
    this.form.controls.warehouse.setValue(id);
    this.form.controls.warehouse.markAsDirty();
  }

  onProductQuery(value: string): void {
    this.productQuery.set(value);
    this.productMenuOpen.set(true);
    const selected = this.selectedProduct();
    if (selected && value.trim() !== this.productChoiceLabel(selected)) {
      this.selectedProduct.set(null);
      this.lineForm.patchValue({ product: 0 });
      this.costHint.set(null);
      return;
    }
    if (!selected && this.editingLineKey()) {
      const line = this.lines().find((row) => row.key === this.editingLineKey());
      if (line && value.trim() !== purchaseOrderProductLabel(line)) {
        this.lineForm.patchValue({ product: 0 });
      }
    }
  }

  openProductMenu(): void {
    this.productMenuOpen.set(true);
  }

  closeProductMenuSoon(): void {
    window.setTimeout(() => this.productMenuOpen.set(false), 180);
  }

  pickProduct(product: Product, event?: Event): void {
    event?.preventDefault();
    this.selectedProduct.set(product);
    this.productQuery.set(this.productChoiceLabel(product));
    this.lineForm.patchValue({ product: product.id });
    this.productMenuOpen.set(false);
    this.prefillCost(product.id);
  }

  editLine(line: EditorLine): void {
    this.editingLineKey.set(line.key);
    this.lineForm.patchValue({
      product: line.product,
      cant: Number(line.cant),
      unit_cost: Number(line.unit_cost),
      received_qty: Number(line.received_qty),
    });
    const product = this.products().find((row) => row.id === line.product) ?? null;
    this.selectedProduct.set(product);
    this.productQuery.set(product ? this.productChoiceLabel(product) : purchaseOrderProductLabel(line));
    this.productMenuOpen.set(false);
    this.costHint.set(null);
  }

  cancelLineEdit(): void {
    this.resetLineForm();
  }

  saveHeader(): void {
    if (!this.auth.canWriteLogistica()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Revisa proveedor, forma de pago y el resto de la cabecera.');
      return;
    }
    const payload = this.headerPayload();
    if (this.isNew() && !this.lines().length) {
      const proceed = window.confirm(
        'La orden se creará sin líneas. Podrás agregarlas después. ¿Continuar?',
      );
      if (!proceed) return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);
    if (this.isNew()) {
      this.ordersApi
        .create({
          ...payload,
          items: this.lines().map((line) => this.toCreateItem(line)),
        })
        .subscribe({
          next: (order) => {
            this.saving.set(false);
            if (!order.id) {
              this.errorMessage.set('La orden se guardó, pero la respuesta no trajo un id.');
              return;
            }
            const coverId = this.coveringLogisticsOrderId();
            if (coverId != null) {
              void this.router.navigate(['/logistica/ordenes-internas', coverId], { replaceUrl: true });
              return;
            }
            void this.router.navigate(['/logistica/ordenes-compra', order.id], { replaceUrl: true });
          },
          error: (err) => {
            this.saving.set(false);
            this.errorMessage.set(formatHttpError(err));
          },
        });
      return;
    }
    const id = this.orderId();
    if (id == null) {
      this.saving.set(false);
      return;
    }
    this.ordersApi.update(id, payload).subscribe({
      next: (order) => {
        this.saving.set(false);
        this.order.set(order);
        this.applyOrderToForm(order);
        this.recomputeTotals();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  saveLine(): void {
    if (!this.auth.canWriteLogistica()) return;
    if (this.lineForm.invalid) {
      this.lineForm.markAllAsTouched();
      this.errorMessage.set('Selecciona un producto e indica cantidad y costo.');
      return;
    }
    const raw = this.lineForm.getRawValue();
    const existing = this.lines().find((line) => line.key === this.editingLineKey());
    const cant = toDecimalString(raw.cant);
    const received = existing?.id != null ? toDecimalString(raw.received_qty) : '0.00';
    if (existing?.max_cant && Number(cant) - Number(existing.max_cant) > 0.0001) {
      this.errorMessage.set(
        `La cantidad no puede superar lo pendiente de la orden interna (${existing.max_cant}).`,
      );
      return;
    }
    if (receivedExceedsOrdered(received, cant)) {
      this.errorMessage.set('La cantidad recibida no puede superar la cantidad pedida.');
      return;
    }
    const productId = existing?.logistics_order_item != null ? existing.product : raw.product;
    const product = this.products().find((row) => row.id === productId);
    const line: EditorLine = {
      key: existing?.key ?? `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      id: existing?.id ?? null,
      product: productId,
      product_sku: existing?.logistics_order_item != null
        ? existing.product_sku
        : product?.sku || existing?.product_sku || '',
      product_description: existing?.logistics_order_item != null
        ? existing.product_description
        : product?.description || existing?.product_description || '',
      cant,
      unit_cost: toDecimalString(raw.unit_cost),
      received_qty: received,
      logistics_order_item: existing?.logistics_order_item ?? null,
      max_cant: existing?.max_cant ?? null,
    };
    this.errorMessage.set(null);
    if (this.isNew()) {
      this.upsertDraft(line);
      return;
    }
    const orderId = this.orderId();
    if (orderId == null) return;
    this.lineSaving.set(true);
    const request =
      line.id == null
        ? this.itemsApi.create({
            purchase_order: orderId,
            product: line.product,
            cant: line.cant,
            unit_cost: line.unit_cost,
            ...(line.logistics_order_item != null
              ? { logistics_order_item: line.logistics_order_item }
              : {}),
          })
        : this.itemsApi.update(line.id, {
            product: line.product,
            cant: line.cant,
            unit_cost: line.unit_cost,
            received_qty: line.received_qty,
          });
    request.subscribe({
      next: () => {
        this.lineSaving.set(false);
        this.resetLineForm();
        this.loadOrder(orderId, { silent: true, keepDirtyHeader: true });
      },
      error: (err) => {
        this.lineSaving.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  removeLine(line: EditorLine): void {
    if (!this.auth.canWriteLogistica()) return;
    if (!window.confirm(`¿Quitar ${purchaseOrderProductLabel(line)}?`)) return;
    if (this.isNew() || line.id == null) {
      this.lines.update((rows) => rows.filter((row) => row.key !== line.key));
      if (this.editingLineKey() === line.key) this.resetLineForm();
      this.recomputeTotals();
      return;
    }
    this.lineSaving.set(true);
    this.errorMessage.set(null);
    this.itemsApi.delete(line.id).subscribe({
      next: () => {
        this.lineSaving.set(false);
        if (this.editingLineKey() === line.key) this.resetLineForm();
        const id = this.orderId();
        if (id != null) this.loadOrder(id, { silent: true, keepDirtyHeader: true });
      },
      error: (err) => {
        this.lineSaving.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  removeOrder(): void {
    const order = this.order();
    if (!order || !this.auth.canWriteLogistica()) return;
    const label = order.correlativo || `#${order.id}`;
    if (!window.confirm(`¿Eliminar la orden de compra ${label}?`)) return;
    this.saving.set(true);
    this.errorMessage.set(null);
    this.ordersApi.delete(order.id).subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate(['/logistica/ordenes-compra']);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  async generateOc(): Promise<void> {
    const order = this.order();
    if (!order || this.isNew()) return;
    if (this.form.dirty || this.editingLineKey()) {
      this.errorMessage.set('Guarda la cabecera y la línea en edición antes de generar la OC.');
      return;
    }
    if (!this.lines().length) {
      this.errorMessage.set('Agrega productos antes de generar la OC.');
      return;
    }
    this.pdfBusy.set(true);
    this.errorMessage.set(null);
    try {
      const supplier = this.suppliers().find((row) => row.id === order.supplier) ?? null;
      const warehouse = this.warehouses().find((row) => row.id === order.warehouse) ?? null;
      const payment = this.paymentMethods().find((row) => row.id === order.payment_methods);
      const names = new Map(this.suppliers().map((row) => [row.id, row.name]));
      await openPurchaseOrderPdf({
        http: this.http,
        companyApi: this.companyApi,
        companyId: this.auth.me()?.profile?.company?.id ?? order.company,
        companyName: this.companyTitle(),
        fallbackLogoUrl: this.auth.me()?.profile?.company?.logo_url ?? null,
        order,
        lines: this.lines(),
        supplier,
        warehouseLabel: warehouse ? formatWarehouseLabel(warehouse, names.get(warehouse.supplier)) : '—',
        paymentMethodName: payment?.name ?? (order.payment_methods ? `#${order.payment_methods}` : '—'),
        totals: this.totals(),
      });
    } catch (err) {
      this.errorMessage.set(formatHttpError(err));
    } finally {
      this.pdfBusy.set(false);
    }
  }

  private loadCatalogs(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      suppliers: this.suppliersApi.list(),
      products: this.productsApi.list().pipe(catchError(() => of([] as Product[]))),
      warehouses: this.warehousesApi.list(),
      payments: this.paymentsApi.list(),
      links: this.productSuppliersApi.list().pipe(catchError(() => of([] as ProductSupplierRow[]))),
    }).subscribe({
      next: ({ suppliers, products, warehouses, payments, links }) => {
        this.suppliers.set([...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'es')));
        this.products.set(products);
        this.warehouses.set(warehouses);
        this.paymentMethods.set([...payments].sort((a, b) => a.name.localeCompare(b.name, 'es')));
        this.productSuppliers.set(links);
        const id = this.orderId();
        if (id == null) {
          this.applyLogisticsPurchaseDraft();
          this.loading.set(false);
          this.recomputeTotals();
          return;
        }
        this.loadOrder(id, { silent: false, keepDirtyHeader: false });
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  private loadOrder(id: number, opts: { silent: boolean; keepDirtyHeader: boolean }): void {
    if (!opts.silent) this.loading.set(true);
    forkJoin({
      order: this.ordersApi.retrieve(id),
      items: this.itemsApi.list(id),
    }).subscribe({
      next: ({ order, items }) => {
        const source = items.length ? items : (order.items ?? []);
        this.order.set(order);
        this.lines.set(this.toEditorLines(source));
        if (!opts.keepDirtyHeader || !this.form.dirty) this.applyOrderToForm(order);
        this.loading.set(false);
        this.recomputeTotals();
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(formatHttpError(err));
      },
    });
  }

  private toEditorLines(items: PurchaseOrderItem[]): EditorLine[] {
    const products = new Map(this.products().map((product) => [product.id, product]));
    return items.map((item, index) => {
      const product = products.get(item.product);
      return {
        key: item.id > 0 ? String(item.id) : `row-${index}`,
        id: item.id > 0 ? item.id : null,
        product: item.product,
        product_sku: item.product_sku || product?.sku || '',
        product_description: item.product_description || product?.description || '',
        cant: item.cant,
        unit_cost: item.unit_cost,
        received_qty: item.received_qty,
        logistics_order_item: null,
        max_cant: null,
      };
    });
  }

  private applyLogisticsPurchaseDraft(): void {
    const draft = readLogisticsPurchaseDraft();
    if (!draft) return;
    this.coveringLogisticsOrderId.set(draft.logisticsOrderId);
    this.lines.set(
      draft.lines.map((line, index) => ({
        key: `cover-${line.logistics_order_item}-${index}`,
        id: null,
        product: line.product,
        product_sku: line.sku,
        product_description: line.description,
        cant: toDecimalString(line.cant),
        unit_cost: '0.00',
        received_qty: '0.00',
        logistics_order_item: line.logistics_order_item,
        max_cant: toDecimalString(line.cant),
      })),
    );
  }

  private toCreateItem(line: EditorLine): PurchaseOrderCreateItem {
    const item: PurchaseOrderCreateItem = {
      product: line.product,
      cant: line.cant,
      unit_cost: line.unit_cost,
    };
    if (line.logistics_order_item != null) item.logistics_order_item = line.logistics_order_item;
    return item;
  }

  private applyOrderToForm(order: PurchaseOrder): void {
    this.form.patchValue({
      supplier: order.supplier,
      money: order.money,
      payment_methods: order.payment_methods ?? 0,
      payment_terms: order.payment_terms,
      incoterm: order.incoterm,
      expected_delivery_date: order.expected_delivery_date ?? '',
      supplier_reference: order.supplier_reference,
      warehouse: order.warehouse ?? 0,
      discount: Number(order.discount),
      tax: Number(order.tax),
      notes: order.notes,
      status: order.status,
    });
    this.form.markAsPristine();
    this.syncLookupLabels();
  }

  private headerPayload(): PurchaseOrderWrite {
    const value = this.form.getRawValue();
    return {
      supplier: value.supplier,
      money: value.money,
      payment_methods: value.payment_methods > 0 ? value.payment_methods : null,
      payment_terms: value.payment_terms.trim(),
      incoterm: value.incoterm.trim().toUpperCase(),
      expected_delivery_date: value.expected_delivery_date || null,
      supplier_reference: value.supplier_reference.trim(),
      warehouse: value.warehouse > 0 ? value.warehouse : null,
      discount: toDecimalString(value.discount),
      tax: toDecimalString(value.tax),
      notes: value.notes.trim(),
      status: value.status,
    };
  }

  private upsertDraft(line: EditorLine): void {
    this.lines.update((rows) => {
      const index = rows.findIndex((row) => row.key === line.key);
      if (index < 0) return [...rows, line];
      const next = [...rows];
      next[index] = line;
      return next;
    });
    this.resetLineForm();
    this.recomputeTotals();
  }

  private resetLineForm(): void {
    this.editingLineKey.set(null);
    this.selectedProduct.set(null);
    this.productQuery.set('');
    this.productMenuOpen.set(false);
    this.costHint.set(null);
    this.lineForm.reset({ product: 0, cant: 1, unit_cost: 0, received_qty: 0 });
  }

  private currentSupplier(): Supplier | null {
    return this.suppliers().find((supplier) => supplier.id === this.form.controls.supplier.value) ?? null;
  }

  private supplierChoiceLabel(supplier: Supplier): string {
    const ruc = supplier.ruc?.trim();
    return ruc ? `${supplier.name} · ${ruc}` : supplier.name;
  }

  private syncLookupLabels(): void {
    const supplier = this.currentSupplier();
    this.supplierQuery.set(supplier ? this.supplierChoiceLabel(supplier) : '');
    const payment = this.paymentMethods().find((method) => method.id === this.form.controls.payment_methods.value);
    this.paymentQuery.set(payment?.name ?? '');
    const warehouse = this.warehouseOptions().find((row) => row.id === this.form.controls.warehouse.value);
    this.warehouseQuery.set(warehouse?.label ?? '');
  }

  private matchesLookup(haystack: string, query: string, selectedLabel: string): boolean {
    const text = query.trim();
    if (!text || text === selectedLabel.trim()) return true;
    return textMatchesLooseQuery(haystack, text);
  }

  private clearLookupIfQueryChanged(value: string, selectedLabel: string, clear: () => void): void {
    if (!selectedLabel || value.trim() === selectedLabel.trim()) return;
    clear();
    this.form.markAsDirty();
  }

  private prefillCost(productId: number): void {
    const supplierId = this.form.controls.supplier.value;
    const row = this.productSuppliers().find(
      (link) => link.product === productId && link.supplier === supplierId,
    );
    if (!row) {
      this.costHint.set(null);
      return;
    }
    this.lineForm.patchValue({ unit_cost: Number(row.cost) });
    const moneyNote =
      row.money === this.form.controls.money.value
        ? ''
        : ` La orden está en ${this.form.controls.money.value}; confirma el costo.`;
    const incoterm = row.incoterm?.trim() ? ` · Incoterm ${row.incoterm}` : '';
    this.costHint.set(`Costo de catálogo: ${row.cost} ${row.money}${incoterm}.${moneyNote}`);
  }

  private recomputeTotals(): void {
    const order = this.order();
    const useServer =
      !this.isNew() &&
      !!order?.total &&
      toDecimalString(this.form.controls.discount.value) === toDecimalString(order.discount) &&
      toDecimalString(this.form.controls.tax.value) === toDecimalString(order.tax);
    this.totals.set(
      resolvePurchaseOrderTotals(
        order,
        this.lines(),
        this.form.controls.discount.value,
        this.form.controls.tax.value,
        useServer,
      ),
    );
  }

  private productChoiceLabel(product: Product): string {
    return `${product.sku} — ${product.description}`;
  }
}
