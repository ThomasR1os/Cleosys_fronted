import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { plainTextFromHtml } from '../../../../core/utils/html-text.utils';
import { AuthService } from '../../../../core/services/auth.service';
import type { Product } from '../../../almacen/models/almacen.models';
import { ProductService } from '../../../almacen/services/product.service';
import type { Supplier } from '../../../core/models/supplier.model';
import { SupplierService } from '../../../core/services/supplier.service';
import type { ProductSupplierMoney, ProductSupplierRow } from '../../../logistica/models/logistica.models';
import { ProductSupplierService } from '../../../logistica/services/product-supplier.service';
import type { TaskComment, TaskEvent, TaskRow } from '../../../tareas/models/task.models';
import { TaskService } from '../../../tareas/services/task.service';
import type {
  AssignableUser,
  GenerateQuotationPayload,
  ItemAvailabilityStatus,
  PaymentMethodRow,
  ProformaClarification,
  ProformaRequestItem,
  ProformaRequestRow,
  QuotationProductRow,
  QuotationRow,
  SupplierOffer,
  SupplierOfferCreatePayload,
  SupplierOfferItem,
  SupplierOfferItemWrite,
} from '../../models/ventas.models';
import { PaymentMethodService } from '../../services/payment-method.service';
import { ProformaRequestItemService } from '../../services/proforma-request-item.service';
import { ProformaRequestService } from '../../services/proforma-request.service';
import { QuotationProductService } from '../../services/quotation-product.service';
import { QuotationService } from '../../services/quotation.service';
import { SupplierOfferService } from '../../services/supplier-offer.service';
import { coerceUserPk } from '../../utils/user-pk.utils';
import {
  availabilityLabel,
  dueIsOverdue,
  effectiveWorkflow,
  queueLabel,
  requestCode,
  taskCode,
  userDisplayName,
  waitingOnLabel,
  workflowBadgeClass,
  workflowLabel,
} from '../../utils/proforma-workflow.utils';

const DEFAULT_QUOTATION_CONDITIONS = `• La instalación es por cuenta del cliente.
• La descarga del equipo corre por cuenta del cliente.
• Incluye arranque inicial en nuestros talleres de Lima.
• Atención Post venta, para manttos., reparación y suministro de repuestos.
• Le brindamos asistencia técnica en nuestros talleres con personal calificado.
• Incluye el traslado del equipo hasta sus instalaciones dentro de Lima Metropolitana`;

type ActionModal =
  | 'logistics'
  | 'ask'
  | 'answer'
  | 'offer'
  | 'quote'
  | 'impossible'
  | null;

interface OfferLineDraft {
  itemId: number;
  /** Línea ya guardada de esta cotización. Null si todavía no existe. */
  offerItemId: number | null;
  included: boolean;
  productId: number;
  productLabel: string;
  productQuery: string;
  supplier_part_number: string;
  unit_cost: string;
  /** Costo copiado de producto–proveedor. Vacío si el usuario lo cambió o no hay tarifa. */
  catalogCost: string;
  catalogMoney: ProductSupplierMoney | '';
  sale_unit_price: string;
  /** Precio de venta copiado del producto. Vacío si el usuario lo cambió o no hay precio. */
  catalogSalePrice: string;
  includes_tax: boolean;
  estimated_lead_time_days: number | null;
  /** Plazo copiado de producto–proveedor. */
  catalogLead: number | null;
  warranty: string;
  available_locally: boolean;
  selected: boolean;
}

interface ItemSupplierQuote {
  offerItemId: number;
  offerId: number;
  supplier: string;
  money: string;
  price: string;
  lead: number | null;
  selected: boolean;
}

interface OfferMatrixCell {
  offerId: number;
  supplierName: string;
  money: string;
  line: SupplierOfferItem | null;
}

interface OfferMatrixRow {
  item: ProformaRequestItem;
  number: string;
  cells: OfferMatrixCell[];
  chosenOfferId: number | null;
  chosenSupplierName: string;
}

@Component({
  selector: 'app-proforma-request-detail',
  imports: [ReactiveFormsModule],
  templateUrl: './proforma-request-detail.component.html',
})
export class ProformaRequestDetailComponent {
  private readonly api = inject(ProformaRequestService);
  private readonly itemsApi = inject(ProformaRequestItemService);
  private readonly offersApi = inject(SupplierOfferService);
  private readonly tasksApi = inject(TaskService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly productsApi = inject(ProductService);
  private readonly productSuppliersApi = inject(ProductSupplierService);
  private readonly quotationsApi = inject(QuotationService);
  private readonly qpApi = inject(QuotationProductService);
  /** Cotizaciones que ya se completaron con precio y plazo del sistema. */
  private readonly completedQuoteIds = new Set<number>();
  private readonly paymentsApi = inject(PaymentMethodService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly requestId = input<number | null>(null);
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly detail = signal<ProformaRequestRow | null>(null);
  readonly items = signal<ProformaRequestItem[]>([]);
  readonly clarifications = signal<ProformaClarification[]>([]);
  readonly offers = signal<SupplierOffer[]>([]);
  readonly task = signal<TaskRow | null>(null);
  readonly events = signal<TaskEvent[]>([]);
  readonly comments = signal<TaskComment[]>([]);
  readonly commentText = signal('');
  readonly actionModal = signal<ActionModal>(null);
  readonly logisticsUsers = signal<AssignableUser[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly paymentMethods = signal<PaymentMethodRow[]>([]);
  readonly supplierPrices = signal<ProductSupplierRow[]>([]);
  readonly supplierPricesReady = signal(false);
  readonly productSearchHits = signal<Product[]>([]);
  readonly offerLines = signal<OfferLineDraft[]>([]);
  /** Cotización de proveedor abierta para editar. Null si es un alta. */
  readonly editingOfferId = signal<number | null>(null);
  private keepLoadedOfferValues = false;
  private productSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private productSearchTicket = 0;
  private productSearchFor = '';
  private priceTicket = 0;

  readonly logisticsForm = this.fb.nonNullable.group({
    assigned_user: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    reason: [''],
  });
  readonly askForm = this.fb.nonNullable.group({
    question: ['', Validators.required],
    item: this.fb.nonNullable.control(0),
  });
  readonly answerForm = this.fb.nonNullable.group({
    clarification: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    answer: ['', Validators.required],
  });
  readonly offerForm = this.fb.nonNullable.group({
    supplier: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    money: this.fb.nonNullable.control<'PEN' | 'USD'>('PEN'),
    exchange_rate: [''],
    payment_methods: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    incoterm: [''],
    valid_until: [''],
  });
  readonly quoteForm = this.fb.nonNullable.group({
    payment_methods: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
    discount: ['0.00'],
    conditions: [DEFAULT_QUOTATION_CONDITIONS],
    works: [''],
    see_sku: this.fb.nonNullable.control(false),
  });
  readonly impossibleForm = this.fb.nonNullable.group({
    reason: ['', Validators.required],
  });

  readonly workflow = computed(() => {
    const row = this.detail();
    return row ? effectiveWorkflow(row) : null;
  });
  readonly myUserId = computed(() => this.auth.me()?.user?.id ?? null);
  readonly role = computed(() => this.auth.me()?.profile?.role ?? '');
  readonly isAdmin = computed(() => this.auth.isAdmin() || this.auth.me()?.user?.is_superuser === true);
  readonly canAct = computed(() => {
    const row = this.detail();
    if (!row) return false;
    if (this.isAdmin()) return true;
    const me = this.myUserId();
    return me != null && coerceUserPk(row.assigned_user) === me;
  });
  readonly isSalesRole = computed(() => {
    const r = this.role();
    return r === 'VENTAS' || r === 'MARKETING' || this.isAdmin();
  });
  readonly isLogisticsRole = computed(() => {
    const r = this.role();
    return r === 'LOGISTICA' || this.isAdmin();
  });
  readonly pendingClarifications = computed(() =>
    this.clarifications().filter((c) => !c.answer?.trim()),
  );
  readonly includedOfferCount = computed(
    () => this.offerLines().filter((line) => line.included).length,
  );
  /** Filas = productos, columnas = proveedores. Cada fila elige uno. */
  readonly offerMatrix = computed<OfferMatrixRow[]>(() => {
    const offers = this.offers();
    return this.quotableItems().map((item) => {
      const cells = offers.map((offer) => ({
        offerId: offer.id,
        supplierName: this.offerSupplierName(offer),
        money: offer.money || 'PEN',
        line: (offer.items ?? []).find((line) => line.proforma_request_item === item.id) ?? null,
      }));
      const chosen = cells.find((cell) => cell.line?.selected);
      return {
        item,
        number: this.offerItemNumber(item.id),
        cells,
        chosenOfferId: chosen?.offerId ?? null,
        chosenSupplierName: chosen?.supplierName ?? '',
      };
    });
  });

  constructor() {
    effect(() => {
      const id = this.requestId();
      if (id == null || id <= 0) return;
      untracked(() => this.reload());
    });
    this.offerForm.controls.supplier.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const mode = this.keepLoadedOfferValues ? 'fill-empty' : 'replace';
      this.keepLoadedOfferValues = false;
      this.loadPricesForLines(mode);
    });
  }

  workflowLabel = workflowLabel;
  workflowBadgeClass = workflowBadgeClass;
  queueLabel = queueLabel;
  waitingOnLabel = waitingOnLabel;
  availabilityLabel = availabilityLabel;
  requestCode = requestCode;
  taskCode = taskCode;
  userDisplayName = userDisplayName;
  dueIsOverdue = dueIsOverdue;

  close(): void {
    if (this.acting()) return;
    this.closed.emit();
  }

  reload(): void {
    const id = this.requestId();
    if (id == null || id <= 0) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.loadPaymentMethods();
    this.api.retrieve(id).subscribe({
      next: (row) => {
        this.detail.set(row);
        this.items.set(row.request_items ?? []);
        this.clarifications.set(row.clarifications ?? []);
        this.offers.set(row.supplier_offers ?? []);
        this.loadRelated(row);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  formatStamp(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }

  clientName(row: ProformaRequestRow): string {
    return row.client_detail?.name?.trim() || `Cliente #${row.client}`;
  }

  itemDescription(itemId: number): string {
    return this.items().find((row) => row.id === itemId)?.description ?? '';
  }

  askLineLabel(item: ProformaRequestItem, index: number): string {
    const n = String(index + 1).padStart(2, '0');
    const desc = item.description?.trim() || 'Sin descripción';
    const short = desc.length > 70 ? `${desc.slice(0, 67)}…` : desc;
    const sku = item.requested_sku?.trim();
    return sku ? `${n} · ${short} · ${sku}` : `${n} · ${short}`;
  }

  itemRecord(itemId: number): ProformaRequestItem | null {
    return this.items().find((row) => row.id === itemId) ?? null;
  }

  offerSupplierName(offer: SupplierOffer): string {
    const nested = offer.supplier_detail?.name?.trim();
    if (nested) return nested;
    const catalog = this.suppliers().find((supplier) => supplier.id === offer.supplier);
    if (catalog?.name.trim()) return catalog.name.trim();
    return offer.supplier ? `Proveedor #${offer.supplier}` : 'Proveedor';
  }

  offerPaymentLabel(offer: SupplierOffer): string {
    const id = offer.payment_methods ?? 0;
    if (id > 0) {
      return this.paymentMethods().find((method) => method.id === id)?.name ?? `Forma de pago #${id}`;
    }
    return offer.payment_terms?.trim() || 'Sin forma de pago';
  }

  supplierCostHint(line: OfferLineDraft): string {
    if (!line.included || line.productId <= 0 || this.offerForm.controls.supplier.value <= 0) return '';
    if (!this.supplierPricesReady()) return '';
    const money = line.catalogMoney ? `${line.catalogMoney} ` : '';
    if (line.catalogCost && line.unit_cost.trim() === line.catalogCost) {
      return `Costo de este proveedor: ${money}${line.catalogCost}`;
    }
    if (line.catalogCost) return `En catálogo de este proveedor: ${money}${line.catalogCost}`;
    return 'Este proveedor no tiene costo cargado para este producto.';
  }

  salePriceHint(line: OfferLineDraft): string {
    if (!line.included || line.productId <= 0 || !this.products().length) return '';
    if (line.catalogSalePrice && line.sale_unit_price.trim() === line.catalogSalePrice) {
      return `Precio de venta del catálogo: ${line.catalogSalePrice}`;
    }
    if (line.catalogSalePrice) return `En catálogo: ${line.catalogSalePrice}`;
    return 'Este producto no tiene precio de venta en el catálogo.';
  }

  leadTimeHint(line: OfferLineDraft): string {
    if (!line.included || line.productId <= 0 || this.offerForm.controls.supplier.value <= 0) return '';
    if (!this.supplierPricesReady()) return '';
    if (line.catalogLead != null && line.estimated_lead_time_days === line.catalogLead) {
      return `Plazo de este proveedor: ${line.catalogLead} días`;
    }
    if (line.catalogLead != null) return `En catálogo de este proveedor: ${line.catalogLead} días`;
    return 'Este proveedor no tiene plazo estimado para este producto.';
  }

  quotesForItem(itemId: number): ItemSupplierQuote[] {
    const quotes: ItemSupplierQuote[] = [];
    for (const offer of this.offers()) {
      for (const line of offer.items ?? []) {
        if (line.proforma_request_item !== itemId || line.id <= 0) continue;
        quotes.push({
          offerItemId: line.id,
          offerId: offer.id,
          supplier: this.offerSupplierName(offer),
          money: offer.money || 'PEN',
          price: line.sale_unit_price,
          lead: line.estimated_lead_time_days ?? null,
          selected: !!line.selected,
        });
      }
    }
    return quotes;
  }

  choosePurchaseOffer(itemId: number, offerId: number): void {
    const line = this.offers()
      .find((offer) => offer.id === offerId)
      ?.items?.find((item) => item.proforma_request_item === itemId);
    if (line == null || line.id <= 0) return;
    this.choosePurchase(itemId, line.id);
  }

  offerColumnMeta(offer: SupplierOffer): string {
    const bits = [offer.money || 'PEN', this.offerPaymentLabel(offer)];
    if (offer.incoterm?.trim()) bits.push(offer.incoterm.trim());
    if (offer.valid_until) bits.push(`Vig. ${this.dateInputValue(offer.valid_until)}`);
    return bits.join(' · ');
  }

  offerById(id: number): SupplierOffer | null {
    return this.offers().find((offer) => offer.id === id) ?? null;
  }

  choosePurchase(itemId: number, offerItemId: number): void {
    if (!this.canRegisterOffer() || this.acting()) return;
    const quotes = this.quotesForItem(itemId);
    if (!quotes.some((quote) => quote.offerItemId === offerItemId)) return;
    this.acting.set(true);
    this.errorMessage.set(null);
    this.offers.update((offers) =>
      offers.map((offer) => ({
        ...offer,
        items: (offer.items ?? []).map((item) =>
          item.proforma_request_item === itemId ? { ...item, selected: item.id === offerItemId } : item,
        ),
      })),
    );
    forkJoin(
      quotes.map((quote) => this.offersApi.patchItem(quote.offerItemId, { selected: quote.offerItemId === offerItemId })),
    ).subscribe({
      next: () => this.acting.set(false),
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
        this.reload();
      },
    });
  }

  leadLabel(days: number | null): string {
    if (days == null) return 'Sin plazo';
    if (days === 0) return 'Inmediato';
    return `${days} día${days === 1 ? '' : 's'}`;
  }

  filteredProducts(query: string): Product[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || this.productSearchFor !== q) return [];
    return this.productSearchHits();
  }

  /** No encontrado y no es posible no se cotizan con un proveedor. */
  private quotableItems(): ProformaRequestItem[] {
    return this.items().filter(
      (item) => item.availability_status !== 'NOT_FOUND' && item.availability_status !== 'NOT_POSSIBLE',
    );
  }

  offerItemNumber(itemId: number): string {
    const index = this.items().findIndex((item) => item.id === itemId);
    const n = index >= 0 ? index + 1 : 1;
    return n < 10 ? `0${n}` : String(n);
  }

  itemQty(item: ProformaRequestItem): string {
    const qty = String(item.quantity ?? '1');
    const unit = item.requested_unit?.trim() || 'UND';
    return `${qty} ${unit}`;
  }

  canSendToLogistics(): boolean {
    if (this.detail()?.quotation) return false;
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isSalesRole() &&
      (wf === 'PENDING_SALES' || wf === 'STOCK_REVIEW' || wf === 'DRAFT' || wf === 'WAITING_SALES_INFORMATION')
    );
  }

  /** La cotización ya existe: ventas la revisa, no vuelve a derivarla. */
  quotationReadyForSales(): boolean {
    const wf = this.workflow();
    if (wf === 'PENDING_SALES_REVIEW' || wf === 'QUOTATION_READY') return true;
    return (
      !!this.detail()?.quotation &&
      (wf === 'PENDING_SALES' || wf === 'STOCK_REVIEW' || wf === 'DRAFT')
    );
  }

  canRequestInfo(): boolean {
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isLogisticsRole() &&
      (wf === 'PENDING_LOGISTICS' || wf === 'LOGISTICS_PROCESSING' || wf === 'WAITING_SUPPLIER')
    );
  }

  canAnswerInfo(): boolean {
    return (
      this.canAct() &&
      this.isSalesRole() &&
      this.workflow() === 'WAITING_SALES_INFORMATION' &&
      this.pendingClarifications().length > 0
    );
  }

  canSendToSupplier(): boolean {
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isLogisticsRole() &&
      (wf === 'PENDING_LOGISTICS' || wf === 'LOGISTICS_PROCESSING')
    );
  }

  canRegisterOffer(): boolean {
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isLogisticsRole() &&
      (wf === 'WAITING_SUPPLIER' || wf === 'LOGISTICS_PROCESSING' || wf === 'PENDING_LOGISTICS')
    );
  }

  canGenerateQuote(): boolean {
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isLogisticsRole() &&
      this.offers().some((o) => (o.items ?? []).some((i) => i.selected)) &&
      (wf === 'LOGISTICS_PROCESSING' || wf === 'WAITING_SUPPLIER' || wf === 'PENDING_LOGISTICS')
    );
  }

  canMarkImpossible(): boolean {
    const wf = this.workflow();
    return (
      this.canAct() &&
      this.isLogisticsRole() &&
      wf !== 'COMPLETED' &&
      wf !== 'CANCELLED' &&
      wf !== 'NOT_POSSIBLE'
    );
  }

  canCompleteFlow(): boolean {
    const wf = this.workflow();
    if (!this.canAct() || !this.isSalesRole()) return false;
    if (wf === 'PENDING_SALES_REVIEW' || wf === 'QUOTATION_READY' || wf === 'NOT_POSSIBLE') return true;
    return (
      !!this.detail()?.quotation &&
      (wf === 'PENDING_SALES' || wf === 'STOCK_REVIEW' || wf === 'DRAFT')
    );
  }

  openAction(kind: Exclude<ActionModal, null>): void {
    this.errorMessage.set(null);
    this.actionModal.set(kind);
    if (kind === 'logistics') {
      this.logisticsForm.reset({ assigned_user: 0, reason: '' });
      this.loadLogisticsUsers();
    }
    if (kind === 'ask') {
      this.askForm.reset({ question: '', item: 0 });
    }
    if (kind === 'answer') {
      const first = this.pendingClarifications()[0];
      this.answerForm.reset({ clarification: first?.id ?? 0, answer: '' });
    }
    if (kind === 'offer') {
      this.editingOfferId.set(null);
      this.offerForm.reset({
        supplier: 0,
        money: 'PEN',
        exchange_rate: '',
        payment_methods: this.paymentMethods()[0]?.id ?? 0,
        incoterm: '',
        valid_until: '',
      });
      this.offerLines.set(this.quotableItems().map((item) => this.blankOfferLine(item, true)));
      this.loadPaymentMethods();
      this.loadOfferCatalogs();
    }
    if (kind === 'quote') {
      this.quoteForm.reset({
        payment_methods: this.quotePaymentDefault(),
        discount: '0.00',
        conditions: DEFAULT_QUOTATION_CONDITIONS,
        works: '',
        see_sku: false,
      });
      this.loadPaymentMethods();
    }
    if (kind === 'impossible') {
      this.impossibleForm.reset({ reason: '' });
    }
  }

  closeAction(): void {
    if (this.acting()) return;
    this.editingOfferId.set(null);
    this.actionModal.set(null);
  }

  openEditOffer(offer: SupplierOffer): void {
    this.errorMessage.set(null);
    this.editingOfferId.set(offer.id);
    this.keepLoadedOfferValues = true;
    this.actionModal.set('offer');
    const savedByItem = new Map((offer.items ?? []).map((line) => [line.proforma_request_item, line]));
    this.offerForm.reset({
      supplier: offer.supplier,
      money: offer.money === 'USD' ? 'USD' : 'PEN',
      exchange_rate: offer.exchange_rate == null || offer.exchange_rate === '' ? '' : String(offer.exchange_rate),
      payment_methods: offer.payment_methods ?? this.paymentMethods()[0]?.id ?? 0,
      incoterm: offer.incoterm ?? '',
      valid_until: this.dateInputValue(offer.valid_until),
    });
    this.offerLines.set(
      this.quotableItems().map((item) => {
        const saved = savedByItem.get(item.id);
        if (!saved) return this.blankOfferLine(item, false);
        const detail = saved.product_detail;
        const detailLabel = [detail?.sku, detail?.description].filter(Boolean).join(' · ');
        return {
          ...this.blankOfferLine(item, true),
          offerItemId: saved.id,
          productId: saved.product,
          productLabel: detailLabel || this.productLabelFor(saved.product),
          supplier_part_number: saved.supplier_part_number ?? '',
          unit_cost: saved.unit_cost ?? '',
          sale_unit_price: saved.sale_unit_price ?? '',
          includes_tax: saved.includes_tax === true,
          estimated_lead_time_days: saved.estimated_lead_time_days ?? null,
          warranty: saved.warranty ?? '',
          available_locally: saved.available_locally === true,
          selected: saved.selected === true,
        };
      }),
    );
    this.loadPaymentMethods();
    this.loadOfferCatalogs();
  }

  deleteOffer(offer: SupplierOffer): void {
    const name = this.offerSupplierName(offer);
    if (!window.confirm(`¿Eliminar la cotización de ${name}?`)) return;
    this.acting.set(true);
    this.errorMessage.set(null);
    this.offersApi.remove(offer.id).subscribe({
      next: () => this.afterAction('Cotización del proveedor eliminada.'),
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  submitLogistics(): void {
    const id = this.detail()?.id;
    if (!id || this.logisticsForm.invalid) {
      this.logisticsForm.markAllAsTouched();
      return;
    }
    const v = this.logisticsForm.getRawValue();
    this.runAction(() =>
      this.api.sendToLogistics(id, {
        assigned_user: v.assigned_user,
        ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
      }),
    );
  }

  submitAsk(): void {
    const id = this.detail()?.id;
    if (!id || this.askForm.invalid) {
      this.askForm.markAllAsTouched();
      return;
    }
    const v = this.askForm.getRawValue();
    this.runAction(() =>
      this.api.requestInformation(id, {
        question: v.question.trim(),
        ...(v.item > 0 ? { item: v.item } : {}),
      }),
    );
  }

  submitAnswer(): void {
    const id = this.detail()?.id;
    if (!id || this.answerForm.invalid) {
      this.answerForm.markAllAsTouched();
      return;
    }
    const v = this.answerForm.getRawValue();
    this.runAction(() =>
      this.api.answerInformation(id, {
        clarification: v.clarification,
        answer: v.answer.trim(),
      }),
    );
  }

  submitSendToSupplier(): void {
    const id = this.detail()?.id;
    if (!id) return;
    if (!window.confirm('¿Marcar la solicitud como enviada al proveedor?')) return;
    this.runAction(() => this.api.sendToSupplier(id));
  }

  private blankOfferLine(item: ProformaRequestItem, included: boolean): OfferLineDraft {
    return {
      itemId: item.id,
      offerItemId: null,
      included,
      productId: item.product ?? 0,
      productLabel: this.productLabelFor(item.product ?? 0),
      productQuery: '',
      supplier_part_number: item.requested_sku ?? '',
      unit_cost: '',
      catalogCost: '',
      catalogMoney: '',
      sale_unit_price: '',
      catalogSalePrice: '',
      includes_tax: false,
      estimated_lead_time_days: null,
      catalogLead: null,
      warranty: '',
      available_locally: false,
      selected: false,
    };
  }

  dateInputValue(value: string | null | undefined): string {
    if (!value) return '';
    return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? '';
  }

  private offerHeaderBody(): Omit<SupplierOfferCreatePayload, 'proforma_request' | 'items'> {
    const v = this.offerForm.getRawValue();
    return {
      supplier: v.supplier,
      money: v.money,
      exchange_rate: v.exchange_rate.trim() || null,
      payment_methods: v.payment_methods,
      incoterm: v.incoterm.trim(),
      valid_until: v.valid_until || null,
    };
  }

  private offerItemBody(line: OfferLineDraft): SupplierOfferItemWrite {
    return {
      proforma_request_item: line.itemId,
      product: line.productId,
      supplier_part_number: line.supplier_part_number.trim(),
      unit_cost: line.unit_cost.trim() || '0.00',
      sale_unit_price: line.sale_unit_price.trim(),
      includes_tax: line.includes_tax,
      estimated_lead_time_days: line.estimated_lead_time_days,
      warranty: line.warranty.trim(),
      available_locally: line.available_locally,
      selected: this.shouldSelectOfferLine(line),
    };
  }

  /** Si el ítem aún no tiene proveedor elegido, esta cotización queda como la de compra. */
  private shouldSelectOfferLine(line: OfferLineDraft): boolean {
    if (line.selected) return true;
    return !this.quotesForItem(line.itemId).some(
      (quote) => quote.selected && quote.offerItemId !== line.offerItemId,
    );
  }

  private syncOfferItems(
    offerId: number,
    lines: OfferLineDraft[],
    existing: SupplierOfferItem[],
  ): Observable<unknown> {
    const kept = new Set<number>();
    const calls: Observable<unknown>[] = [];
    for (const line of lines) {
      const body = this.offerItemBody(line);
      if (line.offerItemId != null && line.offerItemId > 0) {
        kept.add(line.offerItemId);
        calls.push(this.offersApi.patchItem(line.offerItemId, body));
      } else {
        calls.push(this.offersApi.createItem({ ...body, supplier_offer: offerId }));
      }
    }
    for (const item of existing) {
      if (item.id > 0 && !kept.has(item.id)) calls.push(this.offersApi.deleteItem(item.id));
    }
    return calls.length ? forkJoin(calls) : of(null);
  }

  submitOffer(): void {
    const requestId = this.detail()?.id;
    if (!requestId || this.offerForm.invalid) {
      this.offerForm.markAllAsTouched();
      return;
    }
    const included = this.offerLines().filter((line) => line.included);
    if (included.some((line) => line.productId <= 0 || !line.sale_unit_price.trim())) {
      this.errorMessage.set(
        'Cada ítem marcado tiene que tener producto y precio de venta. Si este proveedor no lo cotiza, desmárquelo.',
      );
      return;
    }
    const header = this.offerHeaderBody();
    const editingId = this.editingOfferId();
    this.acting.set(true);
    this.errorMessage.set(null);
    const request =
      editingId == null
        ? this.offersApi.create({ ...header, proforma_request: requestId, items: included.map((line) => this.offerItemBody(line)) })
        : this.offersApi.update(editingId, header).pipe(
            switchMap((offer) => {
              const existing = this.offers().find((row) => row.id === editingId)?.items ?? [];
              return this.syncOfferItems(offer.id, included, existing);
            }),
          );
    request.subscribe({
      next: () =>
        this.afterAction(
          editingId == null ? 'Cotización del proveedor registrada.' : 'Cotización del proveedor actualizada.',
        ),
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private quotePaymentDefault(): number {
    const fromOffers = new Set<number>();
    for (const offer of this.offers()) {
      const method = offer.payment_methods ?? 0;
      if (method <= 0) continue;
      if ((offer.items ?? []).some((item) => item.selected)) fromOffers.add(method);
    }
    if (fromOffers.size === 1) return [...fromOffers][0];
    return this.paymentMethods()[0]?.id ?? 0;
  }

  submitQuote(): void {
    const id = this.detail()?.id;
    if (!id || this.quoteForm.invalid) {
      this.quoteForm.markAllAsTouched();
      return;
    }
    const v = this.quoteForm.getRawValue();
    const body: GenerateQuotationPayload = {
      payment_methods: v.payment_methods,
      discount: v.discount.trim() || '0.00',
      conditions: v.conditions.trim(),
      works: v.works.trim(),
      see_sku: v.see_sku,
    };
    this.acting.set(true);
    this.errorMessage.set(null);
    this.api.generateQuotation(id, body).subscribe({
      next: (quotation) => {
        this.acting.set(false);
        this.actionModal.set(null);
        this.notice.set(`Cotización ${quotation.correlativo} generada para revisión de ventas.`);
        this.changed.emit();
        this.reload();
      },
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  submitImpossible(): void {
    const id = this.detail()?.id;
    if (!id || this.impossibleForm.invalid) {
      this.impossibleForm.markAllAsTouched();
      return;
    }
    const reason = this.impossibleForm.controls.reason.value.trim();
    this.runAction(() => this.api.markNotPossible(id, { reason }));
  }

  submitComplete(): void {
    const id = this.detail()?.id;
    if (!id) return;
    if (!window.confirm('¿Cerrar el flujo de esta solicitud?')) return;
    this.runAction(() => this.api.completeFlow(id));
  }

  goToQuotation(): void {
    const qid = this.detail()?.quotation;
    if (qid == null) return;
    void this.router.navigate(['/ventas/cotizaciones'], { queryParams: { cotizacion: qid } });
  }

  publishComment(): void {
    const taskId = this.task()?.id;
    const body = this.commentText().trim();
    if (taskId == null || !body) return;
    this.acting.set(true);
    this.tasksApi.addComment(taskId, body).subscribe({
      next: (comment) => {
        this.comments.update((rows) => [comment, ...rows]);
        this.commentText.set('');
        this.acting.set(false);
      },
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  setOfferProduct(itemId: number, product: Product): void {
    this.products.update((prev) => (prev.some((row) => row.id === product.id) ? prev : [...prev, product]));
    this.offerLines.update((rows) =>
      rows.map((row) =>
        row.itemId === itemId
          ? {
              ...row,
              productId: product.id,
              productLabel: `${product.sku} · ${product.description}`,
              productQuery: '',
              supplier_part_number: row.supplier_part_number || product.sku,
              warranty: row.warranty || product.warranty || '',
            }
          : row,
      ),
    );
    this.applySupplierCosts('replace', itemId);
    this.loadPricesForLines('replace');
  }

  updateOfferLine(itemId: number, patch: Partial<OfferLineDraft>): void {
    this.offerLines.update((rows) => rows.map((row) => (row.itemId === itemId ? { ...row, ...patch } : row)));
    if (patch.included) this.applySupplierCosts('replace', itemId);
    if (typeof patch.productQuery === 'string') this.scheduleProductSearch(patch.productQuery);
  }

  patchItemAvailability(item: ProformaRequestItem, status: ItemAvailabilityStatus): void {
    this.acting.set(true);
    this.itemsApi.patch(item.id, { availability_status: status }).subscribe({
      next: (updated) => {
        this.items.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
        this.acting.set(false);
      },
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  descriptionText(html: string): string {
    return plainTextFromHtml(html);
  }

  onCommentInput(ev: Event): void {
    this.commentText.set((ev.target as HTMLTextAreaElement).value);
  }

  private loadRelated(row: ProformaRequestRow): void {
    const id = row.id;
    forkJoin({
      items: row.request_items?.length
        ? of(row.request_items)
        : this.itemsApi.listByRequest(id).pipe(catchError(() => of([]))),
      clarifications: row.clarifications?.length
        ? of(row.clarifications)
        : this.api.listClarifications(id).pipe(catchError(() => of([]))),
      offers: row.supplier_offers?.length
        ? of(row.supplier_offers)
        : this.offersApi.listByRequest(id).pipe(catchError(() => of([]))),
      tasks: this.tasksApi.list({ proforma_request: id }).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ items, clarifications, offers, tasks }) => {
        this.items.set(items);
        this.clarifications.set(clarifications);
        this.offers.set([...offers].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)));
        const task = tasks[0] ?? null;
        this.task.set(task);
        if (task?.id) {
          this.events.set(task.events ?? []);
          this.comments.set(task.comments ?? []);
          if (!task.events?.length) {
            this.tasksApi.events(task.id).subscribe({
              next: (ev) => this.events.set(ev),
              error: () => undefined,
            });
          }
        }
        this.loading.set(false);
        this.ensureSuppliersLoaded();
        this.completeQuotationFromSystem(row);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /**
   * Si ventas cotizó con el catálogo, la cotización puede haber quedado sin líneas,
   * sin precio o sin plazo. Los completa con el producto y el tiempo del proveedor.
   */
  private completeQuotationFromSystem(request: ProformaRequestRow): void {
    const quotationId = request.quotation;
    if (quotationId == null || quotationId <= 0 || this.completedQuoteIds.has(quotationId)) return;
    this.completedQuoteIds.add(quotationId);
    const items = [...this.items()];
    const offers = [...this.offers()];
    this.quotationsApi.retrieve(quotationId).subscribe({
      next: (quotation) => {
        this.qpApi.listByQuotation(quotationId).subscribe({
          next: (lines) => this.fillQuotationFromSystem(quotation, items, offers, lines),
          error: () => this.completedQuoteIds.delete(quotationId),
        });
      },
      error: () => this.completedQuoteIds.delete(quotationId),
    });
  }

  private fillQuotationFromSystem(
    quotation: QuotationRow,
    items: ProformaRequestItem[],
    offers: SupplierOffer[],
    lines: QuotationProductRow[],
  ): void {
    const tasks: Observable<unknown>[] = [];
    for (const line of lines) {
      if (!this.quotationLineNeedsSystemData(line)) continue;
      tasks.push(this.patchQuotationLineFromSystem(quotation, items, offers, line));
    }
    if (!lines.length) {
      const covered = new Set<number>();
      for (const item of items) {
        tasks.push(this.createQuotationLineFromItem(quotation, items, offers, item, covered));
      }
    }
    if (!tasks.length) return;
    forkJoin(tasks).subscribe({
      next: () => this.syncGeneratedQuotationHeader(quotation.id),
      error: () => undefined,
    });
  }

  private quotationLineNeedsSystemData(line: QuotationProductRow): boolean {
    return !(Number(line.product_price) > 0) || !(line.delivery_time ?? '').trim();
  }

  private patchQuotationLineFromSystem(
    quotation: QuotationRow,
    items: ProformaRequestItem[],
    offers: SupplierOffer[],
    line: QuotationProductRow,
  ): Observable<unknown> {
    const priceMissing = !(Number(line.product_price) > 0);
    const deliveryMissing = !(line.delivery_time ?? '').trim();
    if (!priceMissing && !deliveryMissing) return of(null);
    const offer = this.selectedOfferForProduct(offers, line.product);
    return this.productsApi.get(line.product).pipe(
      catchError(() => of(null)),
      switchMap((product) => {
        const body: Partial<QuotationProductRow> = {};
        if (priceMissing) {
          const price = this.systemSalePrice(quotation, product, offer);
          if (price != null) body.product_price = price.toFixed(2);
        }
        const write = (): Observable<unknown> =>
          Object.keys(body).length ? this.qpApi.update(line.id, body) : of(null);
        if (!deliveryMissing) return write();
        const known = this.knownDelivery(items, line.product, offer);
        if (known) {
          body.delivery_time = known;
          return write();
        }
        return this.productSuppliersApi.leadTimeLabel(line.product).pipe(
          switchMap((label) => {
            if (label) body.delivery_time = label;
            return write();
          }),
        );
      }),
    );
  }

  private createQuotationLineFromItem(
    quotation: QuotationRow,
    items: ProformaRequestItem[],
    offers: SupplierOffer[],
    item: ProformaRequestItem,
    covered: Set<number>,
  ): Observable<unknown> {
    return this.productForRequestItem(item).pipe(
      switchMap((product) => {
        if (!product || covered.has(product.id)) return of(null);
        covered.add(product.id);
        const offer = this.selectedOfferForItem(offers, item.id) ?? this.selectedOfferForProduct(offers, product.id);
        const price = this.systemSalePrice(quotation, product, offer);
        if (price == null) return of(null);
        const qty = Number(item.quantity);
        const cant = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const warranty = (product.warranty ?? product.warrannty ?? '').trim();
        const write = (delivery: string): Observable<unknown> =>
          this.qpApi.create({
            quotation: quotation.id,
            product: product.id,
            cant,
            product_price: price.toFixed(2),
            delivery_time: delivery,
            line_sku: '',
            line_description: '',
            line_warranty: warranty,
          });
        const known = this.knownDelivery(items, product.id, offer);
        if (known) return write(known);
        return this.productSuppliersApi.leadTimeLabel(product.id).pipe(switchMap((label) => write(label)));
      }),
    );
  }

  private productForRequestItem(item: ProformaRequestItem): Observable<Product | null> {
    if (item.product != null && item.product > 0) {
      return this.productsApi.get(item.product).pipe(catchError(() => of(null)));
    }
    const sku = item.requested_sku?.trim() ?? '';
    if (sku.length < 2) return of(null);
    return this.productsApi.search(sku).pipe(
      switchMap((rows) => of(rows.find((row) => row.sku.trim().toLowerCase() === sku.toLowerCase()) ?? null)),
      catchError(() => of(null)),
    );
  }

  private selectedOfferForItem(offers: SupplierOffer[], itemId: number): SupplierOfferItem | null {
    for (const offer of offers) {
      for (const item of offer.items ?? []) {
        if (item.proforma_request_item === itemId && item.selected && item.product > 0) return item;
      }
    }
    return null;
  }

  private selectedOfferForProduct(offers: SupplierOffer[], productId: number): SupplierOfferItem | null {
    for (const offer of offers) {
      for (const item of offer.items ?? []) {
        if (item.product === productId && item.selected) return item;
      }
    }
    return null;
  }

  private knownDelivery(items: ProformaRequestItem[], productId: number, offer: SupplierOfferItem | null): string {
    if (offer?.available_locally) return '0';
    if (offer?.estimated_lead_time_days != null && offer.estimated_lead_time_days >= 0) {
      return String(Math.trunc(offer.estimated_lead_time_days));
    }
    const item = items.find((row) => row.product === productId);
    if (item?.availability_status === 'IN_STOCK') return '0';
    return '';
  }

  private systemSalePrice(
    quotation: QuotationRow,
    product: Product | null,
    offer: SupplierOfferItem | null,
  ): number | null {
    const offerPrice = Number(offer?.sale_unit_price ?? '');
    if (Number.isFinite(offerPrice) && offerPrice > 0) return this.roundMoney(offerPrice);
    if (!product) return null;
    const raw =
      quotation.quotation_type === 'ALQUILER'
        ? Number(product.rental_price_without_operator ?? 0)
        : Number(product.price ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (quotation.money === 'PEN') {
      const rate = Number(quotation.exchange_rate);
      if (Number.isFinite(rate) && rate > 0) return this.roundMoney(raw * rate);
    }
    return this.roundMoney(raw);
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private syncGeneratedQuotationHeader(quotationId: number): void {
    forkJoin({
      quotation: this.quotationsApi.retrieve(quotationId),
      lines: this.qpApi.listByQuotation(quotationId),
    }).subscribe({
      next: ({ quotation, lines }) => {
        if (!lines.length) return;
        const sub = lines.reduce((sum, line) => sum + line.cant * Number(line.product_price), 0);
        const net = Math.max(0, sub - Number(quotation.discount ?? 0));
        const deliveries = lines.map((line) => (line.delivery_time ?? '').trim()).filter((value) => value.length > 0);
        const patch: Partial<QuotationRow> = { final_price: net.toFixed(2) };
        if (deliveries.length && !(quotation.delivery_time ?? '').trim()) {
          patch.delivery_time = deliveries.reduce((longest, current) =>
            current.length > longest.length ? current : longest,
          );
        }
        this.quotationsApi.update(quotationId, patch).subscribe({ error: () => undefined });
      },
      error: () => undefined,
    });
  }

  private loadPaymentMethods(): void {
    if (this.paymentMethods().length) {
      this.applyDefaultPaymentMethod();
      return;
    }
    this.paymentsApi.list().subscribe({
      next: (rows) => {
        this.paymentMethods.set(rows);
        this.applyDefaultPaymentMethod();
      },
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  private applyDefaultPaymentMethod(): void {
    const first = this.paymentMethods()[0]?.id ?? 0;
    if (first <= 0) return;
    if (this.offerForm.controls.payment_methods.value <= 0) {
      this.offerForm.controls.payment_methods.setValue(first);
    }
    if (this.quoteForm.controls.payment_methods.value <= 0) {
      this.quoteForm.controls.payment_methods.setValue(first);
    }
  }

  private loadOfferCatalogs(): void {
    this.ensureSuppliersLoaded();
    this.loadLineProducts();
  }

  private ensureSuppliersLoaded(): void {
    if (this.suppliers().length) return;
    this.suppliersApi.list().subscribe({
      next: (rows) => this.suppliers.set(rows),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  private loadLineProducts(): void {
    const ids = [...new Set(this.offerLines().map((line) => line.productId).filter((id) => id > 0))];
    const missing = ids.filter((id) => !this.products().some((product) => product.id === id));
    if (!missing.length) {
      this.applySupplierCosts('fill-empty');
      return;
    }
    forkJoin(missing.map((id) => this.productsApi.get(id).pipe(catchError(() => of(null))))).subscribe((rows) => {
      const found = rows.filter((row): row is Product => row != null);
      this.rememberProducts(found);
      this.applySupplierCosts('fill-empty');
    });
  }

  private rememberProducts(found: Product[]): void {
    if (!found.length) return;
    this.products.update((prev) => {
      const byId = new Map(prev.map((product) => [product.id, product]));
      for (const product of found) byId.set(product.id, product);
      return [...byId.values()];
    });
    this.offerLines.update((lines) =>
      lines.map((line) => {
        if (line.productId <= 0) return line;
        const label = this.productLabelFor(line.productId);
        return label && label !== line.productLabel ? { ...line, productLabel: label } : line;
      }),
    );
  }

  private loadPricesForLines(mode: 'replace' | 'fill-empty'): void {
    const supplierId = this.offerForm.controls.supplier.value;
    if (supplierId <= 0) return;
    const ticket = ++this.priceTicket;
    this.supplierPricesReady.set(false);
    this.productSuppliersApi.listForSupplier(supplierId).subscribe({
      next: (rows) => {
        if (ticket !== this.priceTicket) return;
        this.supplierPrices.set(rows);
        this.supplierPricesReady.set(true);
        this.applySupplierCosts(mode);
      },
      error: () => {
        if (ticket !== this.priceTicket) return;
        this.supplierPricesReady.set(true);
      },
    });
  }

  private scheduleProductSearch(query: string): void {
    const text = query.trim();
    if (this.productSearchTimer != null) clearTimeout(this.productSearchTimer);
    if (text.length < 2) {
      this.productSearchHits.set([]);
      this.productSearchFor = '';
      return;
    }
    const ticket = ++this.productSearchTicket;
    this.productSearchTimer = setTimeout(() => {
      this.productsApi.search(text).subscribe({
        next: (rows) => {
          if (ticket !== this.productSearchTicket) return;
          this.productSearchFor = text.toLowerCase();
          this.productSearchHits.set(rows);
        },
        error: () => {
          if (ticket !== this.productSearchTicket) return;
          this.productSearchHits.set([]);
        },
      });
    }, 250);
  }

  private productLabelFor(productId: number, products = this.products()): string {
    if (productId <= 0) return '';
    const product = products.find((row) => row.id === productId);
    return product ? `${product.sku} · ${product.description}` : `Producto #${productId}`;
  }

  private applySupplierCosts(mode: 'replace' | 'fill-empty', onlyItemId?: number): void {
    const supplierId = this.offerForm.controls.supplier.value;
    const pricesReady = this.supplierPricesReady() && supplierId > 0;
    const productsReady = this.products().length > 0;
    if (!pricesReady && !productsReady) return;
    const prices = this.supplierPrices();
    const saleMode: 'replace' | 'fill-empty' = onlyItemId == null && mode === 'replace' ? 'fill-empty' : mode;
    const monies = new Set<ProductSupplierMoney>();
    this.offerLines.update((rows) =>
      rows.map((row) => {
        if (onlyItemId != null && row.itemId !== onlyItemId) return row;
        if (!row.included || row.productId <= 0) return row;
        let next = productsReady ? this.applyCatalogSalePrice(row, saleMode) : row;
        if (!pricesReady) return next;
        const match = prices.find((price) => price.product === next.productId && price.supplier === supplierId);
        if (!match) return this.clearSupplierCatalog(next);
        monies.add(match.money);
        const keepCost = mode === 'fill-empty' && next.unit_cost.trim() !== '' && next.unit_cost !== next.catalogCost;
        const keepLead =
          mode === 'fill-empty' &&
          next.estimated_lead_time_days != null &&
          next.estimated_lead_time_days !== next.catalogLead;
        return {
          ...next,
          unit_cost: keepCost ? next.unit_cost : match.cost,
          catalogCost: match.cost,
          catalogMoney: match.money,
          estimated_lead_time_days: keepLead ? next.estimated_lead_time_days : match.estimated_lead_time_days,
          catalogLead: match.estimated_lead_time_days,
        };
      }),
    );
    if (mode === 'replace' && monies.size === 1 && this.offerForm.controls.money.value !== [...monies][0]) {
      this.offerForm.controls.money.setValue([...monies][0]);
    }
  }

  private applyCatalogSalePrice(row: OfferLineDraft, mode: 'replace' | 'fill-empty'): OfferLineDraft {
    const product = this.products().find((item) => item.id === row.productId);
    const sale = product?.price == null || !Number.isFinite(product.price) ? '' : String(product.price);
    const keepTyped = mode === 'fill-empty' && row.sale_unit_price.trim() !== '' && row.sale_unit_price !== row.catalogSalePrice;
    if (!sale) {
      const clear = row.catalogSalePrice !== '' && row.sale_unit_price === row.catalogSalePrice;
      return { ...row, sale_unit_price: clear ? '' : row.sale_unit_price, catalogSalePrice: '' };
    }
    return {
      ...row,
      sale_unit_price: keepTyped ? row.sale_unit_price : sale,
      catalogSalePrice: sale,
    };
  }

  private clearSupplierCatalog(row: OfferLineDraft): OfferLineDraft {
    const clearCost = row.catalogCost !== '' && row.unit_cost === row.catalogCost;
    const clearLead = row.catalogLead != null && row.estimated_lead_time_days === row.catalogLead;
    return {
      ...row,
      unit_cost: clearCost ? '' : row.unit_cost,
      catalogCost: '',
      catalogMoney: '',
      estimated_lead_time_days: clearLead ? null : row.estimated_lead_time_days,
      catalogLead: null,
    };
  }

  private loadLogisticsUsers(): void {
    forkJoin({
      logistics: this.api.assignableUsers('LOGISTICA').pipe(catchError(() => of([]))),
      admin: this.api.assignableUsers('ADMIN').pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ logistics, admin }) => {
        const map = new Map<number, AssignableUser>();
        for (const u of [...logistics, ...admin]) {
          const pk = coerceUserPk(u.id);
          if (pk != null && !map.has(pk)) map.set(pk, { ...u, id: pk });
        }
        this.logisticsUsers.set([...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      },
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  private runAction(fn: () => ReturnType<ProformaRequestService['sendToSupplier']>): void {
    this.acting.set(true);
    this.errorMessage.set(null);
    fn().subscribe({
      next: () => this.afterAction('Acción registrada. Se notificó al responsable.'),
      error: (err) => {
        this.acting.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private afterAction(message: string): void {
    this.acting.set(false);
    this.editingOfferId.set(null);
    this.actionModal.set(null);
    this.notice.set(message);
    this.changed.emit();
    this.reload();
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) return formatHttpError(err);
    return formatHttpError(err);
  }
}
