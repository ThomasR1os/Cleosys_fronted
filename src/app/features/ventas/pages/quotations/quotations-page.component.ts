import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RowInput } from 'jspdf-autotable';
import type { Row as AutoTableRow } from 'jspdf-autotable';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  concatMap,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  forkJoin,
  from,
  of,
} from 'rxjs';
import { map, toArray } from 'rxjs/operators';
import type { AdminUser, CompanyBranding, UserRole } from '../../../admin/models/admin-users.models';
import { AdminUserService } from '../../../admin/services/admin-user.service';
import { CompanyService } from '../../../admin/services/company.service';
import {
  brandingToPdfTheme,
  DEFAULT_COMPANY_BRANDING,
  type PdfQuotationTheme,
} from '../../../admin/utils/company-branding.utils';
import { AuthService } from '../../../../core/services/auth.service';
import { ProductImageService } from '../../../almacen/services/product-image.service';
import { ProductService } from '../../../almacen/services/product.service';
import type { Product } from '../../../almacen/models/almacen.models';
import type {
  ClientRow,
  PaymentMethodRow,
  QuotationProductRow,
  QuotationRow,
  QuotationStatus,
  QuotationType,
} from '../../models/ventas.models';
import { ClientContactService } from '../../services/client-contact.service';
import { ClientService } from '../../services/client.service';
import { PaymentMethodService } from '../../services/payment-method.service';
import { QuotationProductService } from '../../services/quotation-product.service';
import { QuotationService } from '../../services/quotation.service';

/** Máximo de filas en desplegables buscables (rendimiento con catálogos grandes). */
const PICKER_PAGE = 100;

/** Línea pendiente antes de existir la cotización (POST cotización → POST líneas). */
interface DraftQuotationLine {
  tempId: string;
  product: number;
  cant: number;
  product_price: number;
  line_sku: string;
  line_description: string;
  line_datasheet: string;
}

@Component({
  selector: 'app-quotations-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './quotations-page.component.html',
})
export class QuotationsPageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly quotationsApi = inject(QuotationService);
  private readonly qpApi = inject(QuotationProductService);
  private readonly clientsApi = inject(ClientService);
  private readonly clientContactsApi = inject(ClientContactService);
  private readonly adminUsersApi = inject(AdminUserService);
  private readonly companyApi = inject(CompanyService);
  private readonly payApi = inject(PaymentMethodService);
  private readonly productService = inject(ProductService);
  private readonly productImageApi = inject(ProductImageService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly quotations = signal<QuotationRow[]>([]);
  /** Página actual (0-based) en el listado de cotizaciones. */
  readonly pageIndex = signal(0);
  /** Filas por página en el listado. */
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly totalCount = computed(() => this.quotations().length);
  readonly totalPages = computed(() => {
    const n = this.totalCount();
    const ps = this.pageSize();
    if (n === 0) return 0;
    return Math.ceil(n / ps);
  });
  readonly pagedQuotations = computed(() => {
    const all = this.quotations();
    const ps = this.pageSize();
    const start = this.pageIndex() * ps;
    return all.slice(start, start + ps);
  });
  readonly rangeStart = computed(() => {
    const n = this.totalCount();
    if (n === 0) return 0;
    return this.pageIndex() * this.pageSize() + 1;
  });
  readonly rangeEnd = computed(() => {
    const n = this.totalCount();
    if (n === 0) return 0;
    return Math.min((this.pageIndex() + 1) * this.pageSize(), n);
  });

  readonly qpItems = signal<QuotationProductRow[]>([]);
  readonly clients = signal<ClientRow[]>([]);
  readonly paymentMethods = signal<PaymentMethodRow[]>([]);
  /** Catálogo completo de productos (carga diferida para líneas). */
  readonly productsCatalog = signal<Product[]>([]);
  readonly productsCatalogLoading = signal(false);
  readonly clientsLoading = signal(false);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly savingLine = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingQuotationId = signal<number | null>(null);
  /** Edición de línea existente (servidor). */
  readonly editingLineId = signal<number | null>(null);
  /** Solo lectura (ej. ver líneas sin permiso de edición). */
  readonly quotationModalReadonly = signal(false);
  /** Líneas de una cotización nueva (aún sin `id`). */
  readonly draftLines = signal<DraftQuotationLine[]>([]);
  readonly lineEditorMode = signal<'idle' | 'new' | 'edit'>('idle');
  readonly editingDraftTempId = signal<string | null>(null);

  readonly clientPickerOpen = signal(false);
  readonly productPickerOpen = signal(false);
  readonly clientSearchQuery = signal('');
  readonly productSearchQuery = signal('');
  readonly sellerSearchQuery = signal('');
  readonly sellerPickerOpen = signal(false);
  /** Usuarios rol VENTAS (cuenta admin). */
  readonly salesUsersCatalog = signal<AdminUser[]>([]);
  readonly salesUsersLoading = signal(false);
  /** Contactos del cliente seleccionado (para filtrar vendedores). */
  readonly sellerContactsLoading = signal(false);
  /** Hay al menos un contacto para el cliente (GET contactos). */
  readonly sellerHasContacts = signal(false);
  /** IDs de vendedor asignados en contactos (`user` / `owner`). */
  readonly sellerEligibleIdsFromContacts = signal<Set<number>>(new Set());

  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().trim().toLowerCase();
    const all = this.clients();
    const list = !q
      ? all
      : all.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.ruc && c.ruc.toLowerCase().includes(q)) ||
            String(c.id).includes(q),
        );
    return list.slice(0, PICKER_PAGE);
  });

  readonly filteredProducts = computed(() => {
    const q = this.productSearchQuery().trim().toLowerCase();
    const all = this.productsCatalog();
    const list = !q
      ? all
      : all.filter(
          (p) =>
            p.sku.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            String(p.id).includes(q),
        );
    return list.slice(0, PICKER_PAGE);
  });

  /**
   * Vendedores elegibles (sin filtro de texto).
   * Sin contactos en el cliente: usuarios activos con rol VENTAS.
   * Con contactos y vendedores asignados: esos usuarios (aunque el rol no sea VENTAS).
   * Con contactos pero sin vendedor en ninguno: lista vacía.
   */
  readonly eligibleSalesUsers = computed(() => {
    if (this.sellerContactsLoading()) return [];
    const catalog = this.salesUsersCatalog();
    const hasContacts = this.sellerHasContacts();
    const fromContacts = this.sellerEligibleIdsFromContacts();
    if (!hasContacts) {
      return catalog.filter((u) => u.is_active && u.profile?.role === 'VENTAS');
    }
    if (fromContacts.size === 0) return [];
    return catalog.filter((u) => u.is_active && fromContacts.has(u.id));
  });

  /** Lista acotada para el desplegable (búsqueda + tope de filas). */
  readonly sellersForPicker = computed(() => {
    const q = this.sellerSearchQuery().trim().toLowerCase();
    const list = this.eligibleSalesUsers();
    if (!q) return list.slice(0, PICKER_PAGE);
    return list
      .filter((u) => {
        const full = `${u.first_name} ${u.last_name}`.trim().toLowerCase();
        return (
          u.username.toLowerCase().includes(q) ||
          full.includes(q) ||
          String(u.id).includes(q) ||
          (u.email && u.email.toLowerCase().includes(q))
        );
      })
      .slice(0, PICKER_PAGE);
  });

  readonly myUserId = computed(() => this.auth.me()?.user?.id ?? null);

  readonly typeOpts: { value: QuotationType; label: string }[] = [
    { value: 'VENTA', label: 'Venta' },
    { value: 'ALQUILER', label: 'Alquiler' },
    { value: 'SERVICIO', label: 'Servicio' },
  ];
  readonly moneyOpts = [
    { value: 'USD' as const, label: 'USD — dólares (precios catálogo)' },
    { value: 'PEN' as const, label: 'PEN — soles (indique tipo de cambio)' },
  ];
  readonly statusOpts: { value: QuotationStatus; label: string }[] = [
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'APROBADA', label: 'Aprobada' },
    { value: 'RECHAZADA', label: 'Rechazada' },
  ];

  readonly lineForm = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    product: this.fb.nonNullable.control<number>(0, Validators.required),
    cant: this.fb.nonNullable.control<number>(1, [Validators.required, Validators.min(1)]),
    product_price: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(0)]),
    line_sku: [''],
    line_description: [''],
    line_datasheet: [''],
  });

  /**
   * Moneda en la que están expresados los `product_price` de líneas en pantalla
   * (catálogo en USD; al pasar a PEN se multiplican por el tipo de cambio).
   */
  private linePricesCurrency: 'PEN' | 'USD' = 'USD';
  /** Última moneda de cabecera ya alineada con `linePricesCurrency` (evita conversiones duplicadas). */
  private prevMoneyForLines: 'PEN' | 'USD' = 'USD';

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    quotation_type: this.fb.nonNullable.control<QuotationType>('VENTA', Validators.required),
    money: this.fb.nonNullable.control<'PEN' | 'USD'>('USD', Validators.required),
    /** Obligatorio si moneda = PEN (precios de catálogo en USD). */
    exchangeRate: this.fb.control<number | null>(null),
    status: this.fb.nonNullable.control<QuotationStatus>('PENDIENTE', Validators.required),
    client: this.fb.nonNullable.control<number>(0, Validators.required),
    user: this.fb.control<number | null>(null),
    /** Porcentaje 0–100; el importe enviado al API se calcula sobre el subtotal de líneas. */
    discountPercent: this.fb.nonNullable.control<number>(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    delivery_time: this.fb.nonNullable.control<number>(0, Validators.required),
    conditions: ['', Validators.required],
    payment_methods: this.fb.nonNullable.control<number>(0, Validators.required),
    works: [''],
    see_sku: this.fb.nonNullable.control<boolean>(false),
    lineEdit: this.lineForm,
  });

  ngOnInit(): void {
    this.lineForm.disable({ emitEvent: false });
    this.syncExchangeRateValidators(this.form.controls.money.value);
    this.prevMoneyForLines = this.form.controls.money.value;
    this.linePricesCurrency = this.form.controls.money.value;

    this.form.controls.money.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((m) => {
        const rateSnapshot = this.form.controls.exchangeRate.value;
        const prev = this.prevMoneyForLines;
        if (prev === m) {
          this.syncExchangeRateValidators(m);
          return;
        }
        const proceed = this.onFormMoneyChanged(prev, m, rateSnapshot);
        this.syncExchangeRateValidators(m);
        if (proceed) {
          this.prevMoneyForLines = m;
        }
      });

    this.form.controls.exchangeRate.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.tryApplyUsdToPenWhenRateFilled());

    this.reload();
  }

  /** PEN: tipo de cambio obligatorio; USD: se limpia. */
  private syncExchangeRateValidators(money: 'PEN' | 'USD' | null | undefined): void {
    const ex = this.form.controls.exchangeRate;
    if (money === 'PEN') {
      ex.setValidators([Validators.required, Validators.min(0.0000001)]);
    } else {
      ex.clearValidators();
      ex.setValue(null, { emitEvent: false });
    }
    ex.updateValueAndValidity({ emitEvent: false });
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Convierte importes de línea al cambiar la moneda de la cotización.
   * Debe ejecutarse **antes** de `syncExchangeRateValidators` para conservar el TC al pasar PEN→USD.
   * @returns false si se revirtió la moneda (error); true si el cambio es coherente.
   */
  private onFormMoneyChanged(
    prev: 'PEN' | 'USD',
    next: 'PEN' | 'USD',
    rateSnapshot: number | null | undefined,
  ): boolean {
    if (!this.modalOpen() || this.quotationModalReadonly()) return true;
    if (prev === next) return true;

    if (next === 'PEN' && this.linePricesCurrency === 'USD') {
      const r = Number(rateSnapshot);
      if (Number.isFinite(r) && r > 0) {
        this.multiplyAllLinePricesByRate(r);
        this.linePricesCurrency = 'PEN';
      }
      return true;
    }

    if (next === 'USD' && this.linePricesCurrency === 'PEN') {
      const r = this.resolveRateForPenToUsd(rateSnapshot);
      if (r == null) {
        this.errorMessage.set(
          'Indique el tipo de cambio (o ábrala desde una cotización en soles con TC guardado) para convertir los precios a dólares.',
        );
        this.form.patchValue({ money: 'PEN' }, { emitEvent: false });
        return false;
      }
      this.divideAllLinePricesByRate(r);
      this.linePricesCurrency = 'USD';
      return true;
    }

    return true;
  }

  /** Usuario seleccionó PEN antes de escribir el TC: al completar el tipo de cambio se aplican los soles. */
  private tryApplyUsdToPenWhenRateFilled(): void {
    if (!this.modalOpen() || this.quotationModalReadonly()) return;
    if (this.form.controls.money.value !== 'PEN') return;
    if (this.linePricesCurrency !== 'USD') return;
    const r = Number(this.form.controls.exchangeRate.value);
    if (!Number.isFinite(r) || r <= 0) return;
    this.multiplyAllLinePricesByRate(r);
    this.linePricesCurrency = 'PEN';
  }

  private resolveRateForPenToUsd(rateSnapshot: number | null | undefined): number | null {
    const n = Number(rateSnapshot);
    if (Number.isFinite(n) && n > 0) return n;
    const qid = this.editingQuotationId();
    if (qid == null) return null;
    const row = this.quotations().find((x) => x.id === qid);
    return row ? this.exchangeRateFromRow(row) : null;
  }

  private multiplyAllLinePricesByRate(rate: number): void {
    const mapPrice = (p: number) => this.round2(Number(p) * rate);
    const qid = this.editingQuotationId();
    if (qid == null) {
      this.draftLines.update((lines) =>
        lines.map((l) => ({ ...l, product_price: mapPrice(l.product_price) })),
      );
      if (this.lineForm.enabled) {
        const cur = this.lineForm.controls.product_price.value;
        this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
      }
      return;
    }
    const lines = this.linesForQuotationId(qid);
    if (!lines.length) {
      if (this.lineForm.enabled) {
        const cur = this.lineForm.controls.product_price.value;
        this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
      }
      return;
    }
    this.savingLine.set(true);
    this.errorMessage.set(null);
    const reqs = lines.map((l) =>
      this.qpApi.update(l.id, {
        product_price: mapPrice(Number(l.product_price)).toFixed(2),
      } as Partial<QuotationProductRow>),
    );
    forkJoin(reqs).subscribe({
      next: () => {
        this.savingLine.set(false);
        if (this.lineForm.enabled) {
          const cur = this.lineForm.controls.product_price.value;
          this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
        }
        this.syncQuotationFinalPriceAfterLinesChange(qid);
      },
      error: (err) => {
        this.savingLine.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private divideAllLinePricesByRate(rate: number): void {
    const mapPrice = (p: number) => this.round2(Number(p) / rate);
    const qid = this.editingQuotationId();
    if (qid == null) {
      this.draftLines.update((lines) =>
        lines.map((l) => ({ ...l, product_price: mapPrice(l.product_price) })),
      );
      if (this.lineForm.enabled) {
        const cur = this.lineForm.controls.product_price.value;
        this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
      }
      return;
    }
    const lines = this.linesForQuotationId(qid);
    if (!lines.length) {
      if (this.lineForm.enabled) {
        const cur = this.lineForm.controls.product_price.value;
        this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
      }
      return;
    }
    this.savingLine.set(true);
    this.errorMessage.set(null);
    const reqs = lines.map((l) =>
      this.qpApi.update(l.id, {
        product_price: mapPrice(Number(l.product_price)).toFixed(2),
      } as Partial<QuotationProductRow>),
    );
    forkJoin(reqs).subscribe({
      next: () => {
        this.savingLine.set(false);
        if (this.lineForm.enabled) {
          const cur = this.lineForm.controls.product_price.value;
          this.lineForm.patchValue({ product_price: mapPrice(cur) }, { emitEvent: false });
        }
        this.syncQuotationFinalPriceAfterLinesChange(qid);
      },
      error: (err) => {
        this.savingLine.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  isPenCurrency(): boolean {
    return this.form.controls.money.value === 'PEN';
  }

  linesForQuotationId(quotationId: number): QuotationProductRow[] {
    return this.qpItems()
      .filter((x) => x.quotation === quotationId)
      .sort((a, b) => a.id - b.id);
  }

  /** Subtotal de líneas para una cotización (precio × cantidad). */
  subtotalForQuotationId(quotationId: number): number {
    return this.linesForQuotationId(quotationId).reduce(
      (sum, l) => sum + l.cant * Number(l.product_price),
      0,
    );
  }

  /** Total neto: subtotal − descuento (no negativo). */
  netForQuotation(row: QuotationRow): number {
    const sub = this.subtotalForQuotationId(row.id);
    const disc = Number(row.discount);
    return Math.max(0, sub - disc);
  }

  /** Vista previa en el modal: borrador (cotización nueva) o líneas guardadas. */
  previewSubtotal(): number {
    const id = this.editingQuotationId();
    if (id == null) {
      return this.draftLines().reduce((s, l) => s + l.cant * l.product_price, 0);
    }
    return this.subtotalForQuotationId(id);
  }

  /** % actual del control (acotado 0–100). */
  private clampedDiscountPercent(): number {
    const p = Number(this.form.controls.discountPercent.value ?? 0);
    return Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));
  }

  /** Importe de descuento según subtotal y %. */
  previewDiscountAmount(): number {
    return this.previewSubtotal() * (this.clampedDiscountPercent() / 100);
  }

  previewFinal(): number {
    return Math.max(0, this.previewSubtotal() - this.previewDiscountAmount());
  }

  /** Convierte importe guardado en API + subtotal → % para el formulario. */
  private discountPercentFromStoredAmount(subtotal: number, discountAmount: number): number {
    if (subtotal <= 0) return 0;
    const pct = (Number(discountAmount) / subtotal) * 100;
    return Math.round(pct * 10000) / 10000;
  }

  private exchangeRateFromRow(row: QuotationRow): number | null {
    const r = row.exchange_rate;
    if (r == null || r === '') return null;
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  }

  /** Listado / PDF: tipo de cambio solo aplica en soles; si es nulo se muestra em dash. */
  formatExchangeRateDisplay(row: QuotationRow): string {
    if (row.money !== 'PEN') return '—';
    const n = this.exchangeRateFromRow(row);
    if (n == null) return '—';
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  /** Resumen del modal: TC del formulario o de la fila cargada. */
  previewExchangeRateLabel(): string {
    if (!this.isPenCurrency()) return '';
    const v = this.form.controls.exchangeRate.value;
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n)) {
      return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    const id = this.editingQuotationId();
    if (id != null) {
      const row = this.quotations().find((x) => x.id === id);
      if (row) return this.formatExchangeRateDisplay(row);
    }
    return '—';
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.pageIndex.set(0);
  }

  prevPage(): void {
    this.pageIndex.update((i) => Math.max(0, i - 1));
  }

  nextPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    this.pageIndex.update((i) => Math.min(last, i + 1));
  }

  private clampQuotationPageIndex(): void {
    const tp = this.totalPages();
    if (tp === 0) {
      this.pageIndex.set(0);
      return;
    }
    if (this.pageIndex() >= tp) {
      this.pageIndex.set(tp - 1);
    }
  }

  canEditQuotation(q: QuotationRow): boolean {
    if (this.auth.isAdmin()) return true;
    const me = this.myUserId();
    return me != null && q.user === me;
  }

  /** Modal abierto: nueva cotización (sí) o edición con permiso. */
  canEditLinesInModal(): boolean {
    if (this.quotationModalReadonly()) return false;
    const id = this.editingQuotationId();
    if (id == null) return true;
    const row = this.quotations().find((x) => x.id === id);
    return row != null && this.canEditQuotation(row);
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.clientsLoading.set(true);
    forkJoin({
      q: this.quotationsApi.list(),
      qp: this.qpApi.list(),
      pm: this.payApi.list(),
      cl: this.clientsApi.list(),
    }).subscribe({
      next: ({ q, qp, pm, cl }) => {
        this.quotations.set([...q].sort((a, b) => b.id - a.id));
        this.clampQuotationPageIndex();
        this.qpItems.set(qp);
        this.paymentMethods.set(pm);
        this.clients.set(cl);
        this.clientsLoading.set(false);
        this.loading.set(false);
        if (cl.length && this.form.controls.client.value === 0) {
          this.form.patchValue({ client: cl[0].id });
        }
        if (pm.length && this.form.controls.payment_methods.value === 0) {
          this.form.patchValue({ payment_methods: pm[0].id });
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.clientsLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /** Catálogo de usuarios para el selector de vendedor (solo admin en modal). */
  ensureSalesUsersLoaded(cb?: () => void): void {
    if (this.salesUsersCatalog().length > 0) {
      cb?.();
      return;
    }
    if (this.salesUsersLoading()) return;
    this.salesUsersLoading.set(true);
    this.adminUsersApi.list().subscribe({
      next: (users) => {
        this.salesUsersCatalog.set(users);
        this.salesUsersLoading.set(false);
        cb?.();
      },
      error: (err) => {
        this.salesUsersLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /**
   * Filtra vendedores según contactos del cliente.
   * Regla UX: vendedor debe ser uno asignado a un contacto de ese cliente (cuando existan esos datos).
   */
  refreshSellerEligibility(clientId: number, done?: () => void): void {
    if (!this.auth.isAdmin()) {
      done?.();
      return;
    }
    if (clientId <= 0) {
      this.sellerHasContacts.set(false);
      this.sellerEligibleIdsFromContacts.set(new Set());
      this.sellerContactsLoading.set(false);
      this.syncSellerFormToAllowedList();
      done?.();
      return;
    }
    this.sellerContactsLoading.set(true);
    this.clientContactsApi.listForClient(clientId).subscribe({
      next: (contacts) => {
        const ids = new Set<number>();
        for (const c of contacts) {
          const uid = c.user ?? c.owner;
          if (uid != null && uid > 0) ids.add(uid);
        }
        this.sellerHasContacts.set(contacts.length > 0);
        this.sellerEligibleIdsFromContacts.set(ids);
        this.sellerContactsLoading.set(false);
        this.syncSellerFormToAllowedList();
        done?.();
      },
      error: () => {
        this.sellerContactsLoading.set(false);
        this.sellerHasContacts.set(false);
        this.sellerEligibleIdsFromContacts.set(new Set());
        done?.();
      },
    });
  }

  sellerDisplay(u: AdminUser): string {
    const full = `${u.first_name} ${u.last_name}`.trim();
    return full || u.username || `Usuario #${u.id}`;
  }

  sellerLabelById(id: number): string {
    const u = this.salesUsersCatalog().find((x) => x.id === id);
    return u ? this.sellerDisplay(u) : `Usuario #${id}`;
  }

  /** Si el vendedor elegido no está permitido, se ajusta al primero de la lista o null. */
  private syncSellerFormToAllowedList(): void {
    if (!this.auth.isAdmin()) return;
    const allowed = this.eligibleSalesUsers();
    const cur = this.form.controls.user.value;
    const allowedIds = new Set(allowed.map((u) => u.id));
    if (allowed.length === 0) {
      if (cur != null) {
        this.form.patchValue({ user: null }, { emitEvent: false });
      }
      this.sellerSearchQuery.set('');
      return;
    }
    if (cur == null || !allowedIds.has(cur)) {
      this.form.patchValue({ user: allowed[0]?.id ?? null }, { emitEvent: false });
    }
    const uid = this.form.controls.user.value;
    this.sellerSearchQuery.set(uid != null && uid > 0 ? this.sellerLabelById(uid) : '');
  }

  onSellerSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.sellerSearchQuery.set(v);
    this.sellerPickerOpen.set(true);
  }

  openSellerPicker(): void {
    if (!this.auth.isAdmin()) return;
    this.ensureSalesUsersLoaded(() => this.sellerPickerOpen.set(true));
  }

  closeSellerPickerSoon(): void {
    setTimeout(() => this.sellerPickerOpen.set(false), 180);
  }

  selectSeller(u: AdminUser): void {
    this.form.patchValue({ user: u.id }, { emitEvent: false });
    this.sellerSearchQuery.set(this.sellerDisplay(u));
    this.sellerPickerOpen.set(false);
  }

  ensureProductsCatalog(cb?: () => void): void {
    if (this.productsCatalog().length > 0) {
      cb?.();
      return;
    }
    if (this.productsCatalogLoading()) return;
    this.productsCatalogLoading.set(true);
    this.errorMessage.set(null);
    this.productService.list().subscribe({
      next: (rows) => {
        this.productsCatalog.set(rows);
        this.productsCatalogLoading.set(false);
        cb?.();
      },
      error: (err) => {
        this.productsCatalogLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  clientName(id: number): string {
    const c = this.clients().find((x) => x.id === id);
    return c ? c.name : `#${id}`;
  }

  productOptionLabel(p: Product | null): string {
    if (!p) return '';
    return `${p.sku} — ${p.description}`;
  }

  productLineLabel(line: QuotationProductRow): string {
    if (line.line_sku) return line.line_sku;
    const p = this.productsCatalog().find((x) => x.id === line.product);
    return p ? p.sku : `#${line.product}`;
  }

  productLineDescription(line: QuotationProductRow): string {
    if (line.line_description) return line.line_description;
    const p = this.productsCatalog().find((x) => x.id === line.product);
    return p ? p.description : '—';
  }

  onClientSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.clientSearchQuery.set(v);
    this.clientPickerOpen.set(true);
  }

  onProductSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.productSearchQuery.set(v);
    this.productPickerOpen.set(true);
  }

  selectClient(c: ClientRow): void {
    this.form.patchValue({ client: c.id });
    this.clientSearchQuery.set(`${c.name}${c.ruc ? ` · ${c.ruc}` : ''}`);
    this.clientPickerOpen.set(false);
    if (this.auth.isAdmin() && this.modalOpen()) {
      this.ensureSalesUsersLoaded(() => this.refreshSellerEligibility(c.id));
    }
  }

  /** Rellena texto de línea desde el producto; si no se cambian, al guardar se envían vacíos (el API copia del catálogo). */
  patchLineFormFromProduct(p: Product): void {
    this.lineForm.enable({ emitEvent: false });
    const catalogUsd = p.price ?? 0;
    let unit = catalogUsd;
    if (this.form.controls.money.value === 'PEN') {
      const r = Number(this.form.controls.exchangeRate.value);
      if (Number.isFinite(r) && r > 0) {
        unit = this.round2(catalogUsd * r);
      }
    }
    this.lineForm.patchValue(
      {
        id: null,
        product: p.id,
        cant: 1,
        product_price: unit,
        line_sku: p.sku,
        line_description: p.description,
        line_datasheet: p.datasheet ?? '',
      },
      { emitEvent: false },
    );
  }

  selectProduct(p: Product): void {
    const keepCant =
      this.lineEditorMode() === 'edit' ? this.lineForm.controls.cant.value : 1;
    this.patchLineFormFromProduct(p);
    if (this.lineEditorMode() === 'edit') {
      this.lineForm.patchValue({ cant: keepCant }, { emitEvent: false });
    }
    this.productSearchQuery.set(this.productOptionLabel(p));
    this.productPickerOpen.set(false);
  }

  /**
   * Campos de texto de línea para la API: si coinciden con el producto, cadena vacía (backend rellena desde catálogo).
   */
  private lineTextFieldsForApi(
    productId: number,
    line_sku: string,
    line_description: string,
    line_datasheet: string,
  ): { line_sku: string; line_description: string; line_datasheet: string } {
    const p = this.productsCatalog().find((x) => x.id === productId);
    if (!p) {
      return {
        line_sku: line_sku.trim(),
        line_description: line_description.trim(),
        line_datasheet: line_datasheet.trim(),
      };
    }
    const sku = line_sku.trim();
    const desc = line_description.trim();
    const ds = line_datasheet.trim();
    const skuMatch = sku === '' || sku === p.sku;
    const descMatch = desc === '' || desc === p.description;
    const dsMatch = ds === '' || ds === (p.datasheet ?? '');
    if (skuMatch && descMatch && dsMatch) {
      return { line_sku: '', line_description: '', line_datasheet: '' };
    }
    return { line_sku: sku, line_description: desc, line_datasheet: ds };
  }

  private resetLineEditor(): void {
    this.lineEditorMode.set('idle');
    this.editingLineId.set(null);
    this.editingDraftTempId.set(null);
    this.productSearchQuery.set('');
    this.productPickerOpen.set(false);
    if (this.modalOpen()) {
      this.applyQuotationModalReadonlyToForm();
    } else {
      this.lineForm.disable({ emitEvent: false });
    }
  }

  /**
   * Solo lectura: desactiva el FormGroup (evita `[disabled]` en plantilla con formControlName).
   * Edición: reactiva la cabecera y desactiva el subgrupo de línea si no hay editor abierto.
   */
  private applyQuotationModalReadonlyToForm(): void {
    if (this.quotationModalReadonly()) {
      this.form.disable({ emitEvent: false });
      return;
    }
    this.form.enable({ emitEvent: false });
    if (this.lineEditorMode() === 'idle') {
      this.lineForm.disable({ emitEvent: false });
    } else {
      this.lineForm.enable({ emitEvent: false });
    }
  }

  openClientPicker(): void {
    this.clientPickerOpen.set(true);
  }

  openProductPicker(): void {
    this.ensureProductsCatalog(() => this.productPickerOpen.set(true));
  }

  /** Evita que el blur cierre el menú antes del click en una opción. */
  closeClientPickerSoon(): void {
    setTimeout(() => this.clientPickerOpen.set(false), 180);
  }

  closeProductPickerSoon(): void {
    setTimeout(() => this.productPickerOpen.set(false), 180);
  }

  openNewQuotation(): void {
    this.editingQuotationId.set(null);
    this.quotationModalReadonly.set(false);
    this.draftLines.set([]);
    this.resetLineEditor();
    const cl = this.clients()[0]?.id ?? 0;
    const pm = this.paymentMethods()[0]?.id ?? 0;
    this.clientSearchQuery.set(cl ? this.clientName(cl) : '');
    const sellerId = this.myUserId();
    this.form.reset(
      {
        id: null,
        quotation_type: 'VENTA',
        money: 'USD',
        exchangeRate: null,
        status: 'PENDIENTE',
        client: cl,
        /** Admin elige vendedor; ventas envía siempre su propio usuario al guardar. */
        user: this.auth.isAdmin() ? null : (sellerId ?? null),
        discountPercent: 0,
        delivery_time: 0,
        conditions: '',
        payment_methods: pm,
        works: '',
        see_sku: false,
      },
      { emitEvent: false },
    );
    this.prevMoneyForLines = 'USD';
    this.linePricesCurrency = 'USD';
    this.syncExchangeRateValidators('USD');
    this.modalOpen.set(true);
    this.clientPickerOpen.set(false);
    this.sellerPickerOpen.set(false);
    this.sellerSearchQuery.set('');
    this.applyQuotationModalReadonlyToForm();
    if (this.auth.isAdmin()) {
      this.sellerContactsLoading.set(true);
      this.ensureSalesUsersLoaded(() => {
        this.refreshSellerEligibility(this.form.controls.client.value);
      });
    }
  }

  /** Abre el modal solo lectura (ver cabecera y líneas). */
  openViewQuotation(row: QuotationRow): void {
    this.quotationModalReadonly.set(true);
    this.editingQuotationId.set(row.id);
    this.draftLines.set([]);
    this.resetLineEditor();
    this.clientSearchQuery.set(row.client ? this.clientName(row.client) : '');
    const sub = this.subtotalForQuotationId(row.id);
    this.form.patchValue(
      {
        id: row.id,
        quotation_type: row.quotation_type,
        money: row.money,
        exchangeRate: this.exchangeRateFromRow(row),
        status: row.status,
        client: row.client,
        user: row.user,
        discountPercent: this.discountPercentFromStoredAmount(sub, Number(row.discount)),
        delivery_time: row.delivery_time,
        conditions: row.conditions,
        payment_methods: row.payment_methods,
        works: row.works,
        see_sku: row.see_sku,
      },
      { emitEvent: false },
    );
    this.prevMoneyForLines = row.money;
    this.linePricesCurrency = row.money;
    this.syncExchangeRateValidators(row.money);
    this.modalOpen.set(true);
    this.clientPickerOpen.set(false);
    this.sellerPickerOpen.set(false);
    if (this.auth.isAdmin()) {
      this.sellerContactsLoading.set(true);
      this.ensureSalesUsersLoaded(() => this.refreshSellerEligibility(row.client));
    } else {
      this.sellerSearchQuery.set('');
    }
    this.applyQuotationModalReadonlyToForm();
    this.ensureProductsCatalog();
  }

  openEditQuotation(row: QuotationRow): void {
    if (!this.canEditQuotation(row)) return;
    this.quotationModalReadonly.set(false);
    this.editingQuotationId.set(row.id);
    this.draftLines.set([]);
    this.resetLineEditor();
    this.clientSearchQuery.set(`${row.client ? this.clientName(row.client) : ''}`);
    const sub = this.subtotalForQuotationId(row.id);
    this.form.patchValue(
      {
        id: row.id,
        quotation_type: row.quotation_type,
        money: row.money,
        exchangeRate: this.exchangeRateFromRow(row),
        status: row.status,
        client: row.client,
        user: row.user,
        discountPercent: this.discountPercentFromStoredAmount(sub, Number(row.discount)),
        delivery_time: row.delivery_time,
        conditions: row.conditions,
        payment_methods: row.payment_methods,
        works: row.works,
        see_sku: row.see_sku,
      },
      { emitEvent: false },
    );
    this.prevMoneyForLines = row.money;
    this.linePricesCurrency = row.money;
    this.syncExchangeRateValidators(row.money);
    this.lineForm.disable({ emitEvent: false });
    this.modalOpen.set(true);
    this.clientPickerOpen.set(false);
    this.sellerPickerOpen.set(false);
    if (this.auth.isAdmin()) {
      this.sellerContactsLoading.set(true);
      this.ensureSalesUsersLoaded(() => {
        this.refreshSellerEligibility(row.client);
      });
    } else {
      this.sellerSearchQuery.set('');
    }
    this.ensureProductsCatalog();
  }

  closeQuotationModal(): void {
    this.modalOpen.set(false);
    this.errorMessage.set(null);
    this.sellerPickerOpen.set(false);
    this.draftLines.set([]);
    this.resetLineEditor();
    this.quotationModalReadonly.set(false);
  }

  saveQuotation(): void {
    if (this.lineEditorMode() !== 'idle') {
      this.errorMessage.set('Guarde o cancele la línea en edición antes de guardar la cotización.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const id = this.editingQuotationId();
    const prefixOk =
      this.auth.quotationPrefix() != null &&
      this.auth.quotationPrefix() !== '' &&
      this.auth.quotationPrefix() !== '—';
    if (id == null && !this.auth.isAdmin() && !prefixOk) {
      this.errorMessage.set(
        'Configure el prefijo de cotizaciones en su perfil antes de crear una cotización.',
      );
      return;
    }
    let quotationUserId: number;
    if (this.auth.isAdmin()) {
      if (v.user == null || v.user <= 0) {
        this.errorMessage.set('Seleccione el usuario vendedor de la cotización.');
        return;
      }
      quotationUserId = v.user;
    } else {
      const uid = this.myUserId();
      if (uid == null || uid <= 0) {
        this.errorMessage.set('No se pudo determinar su usuario. Cierre sesión y vuelva a entrar.');
        return;
      }
      quotationUserId = uid;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const sub = this.previewSubtotal();
    const discAmt = this.previewDiscountAmount();
    const finalNet = Math.max(0, sub - discAmt);
    const body: Record<string, unknown> = {
      quotation_type: v.quotation_type,
      money: v.money,
      status: v.status,
      client: v.client,
      user: quotationUserId,
      /** API histórico: importe descontado (compatible con `subtotal − discount`). */
      discount: discAmt.toFixed(2),
      final_price: finalNet.toFixed(2),
      delivery_time: v.delivery_time,
      conditions: v.conditions,
      payment_methods: v.payment_methods,
      works: v.works,
      see_sku: v.see_sku,
    };
    if (v.money === 'PEN') {
      body['exchange_rate'] = Number(v.exchangeRate).toFixed(4);
    } else {
      body['exchange_rate'] = null;
    }
    if (id == null && v.id != null) {
      body['id'] = v.id;
    }

    if (id == null) {
      this.quotationsApi
        .create(body as Partial<QuotationRow>)
        .pipe(
          concatMap((qRow) => {
            const drafts = this.draftLines();
            if (!drafts.length) return of(qRow);
            return from(drafts).pipe(
              concatMap((d) => {
                const texts = this.lineTextFieldsForApi(
                  d.product,
                  d.line_sku,
                  d.line_description,
                  d.line_datasheet,
                );
                return this.qpApi.create({
                  quotation: qRow.id,
                  product: d.product,
                  cant: d.cant,
                  product_price: Number(d.product_price).toFixed(2),
                  ...texts,
                } as Partial<QuotationProductRow>);
              }),
              toArray(),
              map(() => qRow),
            );
          }),
        )
        .subscribe({
          next: (qRow) => {
            this.saving.set(false);
            this.modalOpen.set(false);
            this.draftLines.set([]);
            this.resetLineEditor();
            this.syncQuotationFinalPriceAfterLinesChange(qRow.id);
          },
          error: (err) => {
            this.saving.set(false);
            this.errorMessage.set(this.fmt(err));
          },
        });
      return;
    }

    this.quotationsApi.update(id, body as Partial<QuotationRow>).subscribe({
      next: () => {
        this.saving.set(false);
        this.modalOpen.set(false);
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  removeQuotation(row: QuotationRow): void {
    if (!this.canEditQuotation(row)) return;
    if (!window.confirm(`¿Eliminar la cotización ${row.correlativo}?`)) return;
    this.errorMessage.set(null);
    this.quotationsApi.delete(row.id).subscribe({
      next: () => {
        this.reload();
      },
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  beginAddLineInModal(): void {
    if (this.quotationModalReadonly()) return;
    const qid = this.editingQuotationId();
    if (qid != null) {
      const row = this.quotations().find((x) => x.id === qid);
      if (!row || !this.canEditQuotation(row)) return;
    }
    this.ensureProductsCatalog(() => {
      const first = this.productsCatalog()[0];
      if (!first) {
        this.errorMessage.set('No hay productos en catálogo.');
        return;
      }
      this.lineEditorMode.set('new');
      this.editingLineId.set(null);
      this.editingDraftTempId.set(null);
      this.patchLineFormFromProduct(first);
      this.productSearchQuery.set(this.productOptionLabel(first));
      this.productPickerOpen.set(false);
      this.applyQuotationModalReadonlyToForm();
    });
  }

  beginEditServerLineInModal(row: QuotationProductRow): void {
    if (this.quotationModalReadonly()) return;
    const q = this.quotations().find((x) => x.id === row.quotation);
    if (!q || !this.canEditQuotation(q)) return;
    this.ensureProductsCatalog(() => {
      this.lineEditorMode.set('edit');
      this.editingLineId.set(row.id);
      this.editingDraftTempId.set(null);
      const p = this.productsCatalog().find((x) => x.id === row.product);
      this.lineForm.patchValue(
        {
          id: row.id,
          product: row.product,
          cant: row.cant,
          product_price: Number(row.product_price),
          line_sku: row.line_sku ?? p?.sku ?? '',
          line_description: row.line_description ?? p?.description ?? '',
          line_datasheet: row.line_datasheet ?? p?.datasheet ?? '',
        },
        { emitEvent: false },
      );
      this.productSearchQuery.set(p ? this.productOptionLabel(p) : `#${row.product}`);
      this.productPickerOpen.set(false);
      this.applyQuotationModalReadonlyToForm();
    });
  }

  beginEditDraftLineInModal(d: DraftQuotationLine): void {
    if (this.quotationModalReadonly()) return;
    this.ensureProductsCatalog(() => {
      const p = this.productsCatalog().find((x) => x.id === d.product);
      this.lineEditorMode.set('edit');
      this.editingLineId.set(null);
      this.editingDraftTempId.set(d.tempId);
      this.lineForm.patchValue(
        {
          id: null,
          product: d.product,
          cant: d.cant,
          product_price: d.product_price,
          line_sku: d.line_sku,
          line_description: d.line_description,
          line_datasheet: d.line_datasheet,
        },
        { emitEvent: false },
      );
      this.productSearchQuery.set(p ? this.productOptionLabel(p) : `#${d.product}`);
      this.productPickerOpen.set(false);
      this.applyQuotationModalReadonlyToForm();
    });
  }

  cancelLineEditorInModal(): void {
    this.resetLineEditor();
  }

  commitLineEditorInModal(): void {
    if (this.quotationModalReadonly()) return;
    if (this.lineForm.invalid) {
      this.lineForm.markAllAsTouched();
      return;
    }
    const v = this.lineForm.getRawValue();
    const qid = this.editingQuotationId();
    const texts = this.lineTextFieldsForApi(
      v.product,
      v.line_sku ?? '',
      v.line_description ?? '',
      v.line_datasheet ?? '',
    );

    if (qid == null) {
      const mode = this.lineEditorMode();
      if (mode === 'new') {
        this.draftLines.update((lines) => [
          ...lines,
          {
            tempId: crypto.randomUUID(),
            product: v.product,
            cant: v.cant,
            product_price: v.product_price,
            line_sku: v.line_sku ?? '',
            line_description: v.line_description ?? '',
            line_datasheet: v.line_datasheet ?? '',
          },
        ]);
      } else if (mode === 'edit') {
        const tid = this.editingDraftTempId();
        if (tid) {
          this.draftLines.update((lines) =>
            lines.map((l) =>
              l.tempId === tid
                ? {
                    ...l,
                    product: v.product,
                    cant: v.cant,
                    product_price: v.product_price,
                    line_sku: v.line_sku ?? '',
                    line_description: v.line_description ?? '',
                    line_datasheet: v.line_datasheet ?? '',
                  }
                : l,
            ),
          );
        }
      }
      this.resetLineEditor();
      return;
    }

    const q = this.quotations().find((x) => x.id === qid);
    if (!q || !this.canEditQuotation(q)) return;

    this.savingLine.set(true);
    this.errorMessage.set(null);
    const lineId = this.editingLineId();
    const payload: Record<string, unknown> = {
      quotation: qid,
      product: v.product,
      cant: v.cant,
      product_price: Number(v.product_price).toFixed(2),
      ...texts,
    };
    const req =
      lineId == null
        ? this.qpApi.create(payload as Partial<QuotationProductRow>)
        : this.qpApi.update(lineId, {
            quotation: qid,
            product: v.product,
            cant: v.cant,
            product_price: Number(v.product_price).toFixed(2),
            ...texts,
          } as Partial<QuotationProductRow>);
    req.subscribe({
      next: () => {
        this.savingLine.set(false);
        this.resetLineEditor();
        this.reload();
      },
      error: (err) => {
        this.savingLine.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  removeServerLineInModal(row: QuotationProductRow): void {
    const q = this.quotations().find((x) => x.id === row.quotation);
    if (!q || !this.canEditQuotation(q)) return;
    if (!window.confirm('¿Eliminar esta línea?')) return;
    this.errorMessage.set(null);
    this.qpApi.delete(row.id).subscribe({
      next: () => this.syncQuotationFinalPriceAfterLinesChange(q.id),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  removeDraftLine(tempId: string): void {
    if (this.quotationModalReadonly()) return;
    this.draftLines.update((lines) => lines.filter((l) => l.tempId !== tempId));
  }

  draftLineSku(d: DraftQuotationLine): string {
    const t = d.line_sku.trim();
    if (t) return t;
    const p = this.productsCatalog().find((x) => x.id === d.product);
    return p?.sku ?? `#${d.product}`;
  }

  draftLineDescription(d: DraftQuotationLine): string {
    const t = d.line_description.trim();
    if (t) return t;
    const p = this.productsCatalog().find((x) => x.id === d.product);
    return p?.description ?? '—';
  }

  /** Recalcula subtotal de líneas y persiste `final_price` en la cotización (no editable a mano). */
  private syncQuotationFinalPriceAfterLinesChange(quotationId: number): void {
    this.qpApi.list().subscribe({
      next: (qp) => {
        const row = this.quotations().find((x) => x.id === quotationId);
        if (!row) {
          this.reload();
          return;
        }
        const sub = qp
          .filter((l) => l.quotation === quotationId)
          .reduce((sum, l) => sum + l.cant * Number(l.product_price), 0);
        const net = Math.max(0, sub - Number(row.discount));
        this.quotationsApi.update(quotationId, { final_price: net.toFixed(2) }).subscribe({
          next: () => this.reload(),
          error: () => this.reload(),
        });
      },
      error: () => this.reload(),
    });
  }

  correlativoEditing(): string {
    const id = this.editingQuotationId();
    if (id == null) return '';
    return this.quotations().find((x) => x.id === id)?.correlativo ?? '';
  }

  /** Genera un PDF con la cotización guardada (cabecera, líneas y totales). */
  viewQuotationPdf(row: QuotationRow): void {
    const run = () =>
      this.ensureProductsCatalog(() => {
        void (async () => {
          const qpLines = this.linesForQuotationId(row.id);
          const creatorUser = await this.resolveCreatorUserForPdf(row);
          const companyId = this.resolveQuotationPdfCompanyId(row, creatorUser);
          const companyPdf = await this.loadCompanyPdfAssets(companyId);
          const T = brandingToPdfTheme(companyPdf.branding);
          const [sellerLabel, productImages, creatorIconPng] = await Promise.all([
            this.resolveSellerLabelForPdf(row),
            this.loadProductImageDataUrlsForPdf(qpLines.map((l) => l.product)),
            this.rasterizePdfUserIconSvg(T.primary),
          ]);
          this.generateQuotationPdf(
            row,
            T,
            companyPdf.logoDataUrl,
            sellerLabel,
            productImages,
            companyPdf.bankAccounts,
            creatorUser,
            creatorIconPng,
          );
        })();
      });
    if (this.auth.isAdmin()) {
      this.ensureSalesUsersLoaded(run);
    } else {
      run();
    }
  }

  /** Nombre del vendedor para PDF: catálogo o GET usuario (evita «Usuario #id»). */
  private async resolveSellerLabelForPdf(row: QuotationRow): Promise<string> {
    const id = row.user;
    if (id <= 0) return '—';
    const cached = this.salesUsersCatalog().find((u) => u.id === id);
    if (cached) return this.sellerDisplay(cached);
    try {
      const u = await firstValueFrom(this.adminUsersApi.retrieve(id));
      return this.sellerDisplay(u);
    } catch {
      return `Usuario #${id}`;
    }
  }

  /** Usuario que creó la cotización (`row.user`) para el bloque centrado al pie del PDF. */
  private async resolveCreatorUserForPdf(row: QuotationRow): Promise<AdminUser | null> {
    const id = row.user;
    if (id <= 0) return null;
    const cached = this.salesUsersCatalog().find((u) => u.id === id);
    if (cached) return cached;
    try {
      return await firstValueFrom(this.adminUsersApi.retrieve(id));
    } catch {
      return null;
    }
  }

  /**
   * Empresa cuyo branding y logo deben usarse en el PDF: FK en cotización, si no la del vendedor, si no la del usuario actual.
   */
  private resolveQuotationPdfCompanyId(row: QuotationRow, creator: AdminUser | null): number | null {
    const fromRow = row.company;
    if (fromRow != null && fromRow > 0) return fromRow;
    const fromCreator = creator?.profile?.company?.id;
    if (fromCreator != null && fromCreator > 0) return fromCreator;
    const me = this.auth.me()?.profile?.company?.id;
    if (me != null && me > 0) return me;
    return null;
  }

  /** Convierte el SVG del icono usuario a PNG (data URL) para `addImage` en jsPDF. */
  private rasterizePdfUserIconSvg(primary: [number, number, number]): Promise<string | null> {
    const [r, g, b] = primary;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="8" r="4" stroke="rgb(${r},${g},${b})" stroke-width="1.75" stroke-linecap="round"/>
  <path d="M4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" stroke="rgb(${r},${g},${b})" stroke-width="1.75" stroke-linecap="round"/>
</svg>`;
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const img = new Image();
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  private roleLabelPdf(role: UserRole): string {
    const labels: Record<UserRole, string> = {
      ALMACEN: 'Área: Almacén',
      VENTAS: 'Área: Ventas',
      LOGISTICA: 'Área: Logística',
      ADMIN: 'Área: Administración',
    };
    return labels[role] ?? role;
  }

  /** Desde el modal abierto (ver o editar cotización ya guardada). */
  viewQuotationPdfFromModal(): void {
    const id = this.editingQuotationId();
    if (id == null) return;
    const row = this.quotations().find((x) => x.id === id);
    if (!row) return;
    this.viewQuotationPdf(row);
  }

  /**
   * Logo (`logo` API o `public/branding/`), cuentas bancarias y paleta (`branding`) de la empresa emisora.
   */
  private async loadCompanyPdfAssets(companyId: number | null): Promise<{
    logoDataUrl: string | null;
    bankAccounts: string;
    branding: CompanyBranding;
  }> {
    let bankAccounts = '';
    let branding: CompanyBranding = { ...DEFAULT_COMPANY_BRANDING };
    if (companyId != null && companyId > 0) {
      try {
        const co = await firstValueFrom(this.companyApi.retrieve(companyId));
        bankAccounts = co.bank_accounts?.trim() ?? '';
        if (co.branding) branding = { ...DEFAULT_COMPANY_BRANDING, ...co.branding };
        if (co.logo?.trim()) {
          const fromUrl = await this.blobUrlToDataUrl(co.logo.trim());
          if (fromUrl) {
            return { logoDataUrl: fromUrl, bankAccounts, branding };
          }
        }
      } catch {
        /* continuar con logo local */
      }
    }
    const paths = ['/branding/company-logo.png', '/branding/company-logo.jpg'];
    for (const p of paths) {
      try {
        const blob = await firstValueFrom(this.http.get(p, { responseType: 'blob' }));
        if (blob.size === 0) continue;
        const logoDataUrl = await this.blobToDataUrl(blob);
        return { logoDataUrl, bankAccounts, branding };
      } catch {
        continue;
      }
    }
    return { logoDataUrl: null, bankAccounts, branding };
  }

  private blobToDataUrl(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  }

  /** Descarga la imagen del logo (p. ej. Cloudinary) para incrustarla en el PDF. */
  private async blobUrlToDataUrl(imageUrl: string): Promise<string | null> {
    try {
      const res = await fetch(imageUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size === 0) return null;
      return await this.blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  /** `topY` un poco más abajo que el borde superior para no pegar el logo al borde / línea. */
  private addCompanyLogoToPdf(
    doc: jsPDF,
    dataUrl: string,
    pageW: number,
    margin: number,
    topY = 0,
  ): void {
    const fmt: 'PNG' | 'JPEG' = dataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG';
    const props = doc.getImageProperties(dataUrl);
    const maxW = 52;
    const maxH = 26;
    const scale = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * scale;
    const h = props.height * scale;
    const y = topY > 0 ? topY : margin + 7;
    doc.addImage(dataUrl, fmt, pageW - margin - w, y, w, h);
  }

  /** Imagen principal por producto (data URL) para el PDF. */
  private async loadProductImageDataUrlsForPdf(productIds: number[]): Promise<Map<number, string | null>> {
    const map = new Map<number, string | null>();
    const unique = [...new Set(productIds.filter((id) => id > 0))];
    if (!unique.length) return map;
    try {
      const all = await firstValueFrom(this.productImageApi.list());
      for (const pid of unique) {
        const imgs = all.filter((i) => i.product === pid && i.url?.trim());
        const pick = imgs.find((i) => i.primary) ?? imgs[0];
        if (!pick) {
          map.set(pid, null);
          continue;
        }
        map.set(pid, await this.blobUrlToDataUrl(pick.url));
      }
    } catch {
      for (const pid of unique) map.set(pid, null);
    }
    return map;
  }

  /** Texto de ficha: línea o catálogo. */
  private lineDatasheetForPdf(line: QuotationProductRow): string {
    const t = line.line_datasheet?.trim();
    if (t) return t;
    const p = this.productsCatalog().find((x) => x.id === line.product);
    return p?.datasheet?.trim() ?? '';
  }

  /** Tamaño de la foto de producto en PDF (debajo de la ficha); ancho máx. ~ancho de celda. */
  private pdfDescImageDisplayMm(
    doc: jsPDF,
    dataUrl: string,
    cellInnerW: number,
  ): { w: number; h: number } {
    const maxW = Math.min(44, Math.max(24, cellInnerW));
    const maxH = 30;
    try {
      const p = doc.getImageProperties(dataUrl);
      const s = Math.min(maxW / p.width, maxH / p.height);
      return { w: p.width * s, h: p.height * s };
    } catch {
      return { w: maxW, h: maxH * 0.55 };
    }
  }

  private estimatePdfDescCellHeight(
    doc: jsPDF,
    line: QuotationProductRow,
    descColWidthMm: number,
    productImages: Map<number, string | null>,
    T: PdfQuotationTheme,
  ): number {
    const padV = 3.5;
    const hasImg = !!productImages.get(line.product);
    const innerW = Math.max(18, descColWidthMm - 4);
    const main = this.productLineDescription(line);
    const ds = this.lineDatasheetForPdf(line);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const mainLines = doc.splitTextToSize(main, innerW).length;
    /** Alineado con `didDrawCell`: padding + offset a primera línea + cuerpo + padding. */
    let h = padV + 3.3 + mainLines * 4.1 + padV;
    if (ds) {
      doc.setFont('times', 'italic');
      doc.setFontSize(7);
      const dsLines = doc.splitTextToSize(ds, innerW).length;
      doc.setFont('helvetica', 'normal');
      h += 1.2 + 4 + dsLines * 3.5;
    }
    if (hasImg) {
      const url = productImages.get(line.product);
      const { h: imgH } = url
        ? this.pdfDescImageDisplayMm(doc, url, innerW)
        : { h: 28 };
      h += 3 + imgH + 2;
    }
    /** Margen extra para redondeos de línea y que AutoTable no subestime la altura. */
    return Math.max(h, 16) + T.pdfDescExtraPadding + 2;
  }

  /**
   * jsPDF-AutoTable usa `row.index === -1` en la fila continuación al partir una fila entre páginas.
   * El índice de línea de producto se obtiene desde la 1.ª columna (# ítem).
   */
  private resolveQuotationPdfProductLineIndex(
    row: Pick<AutoTableRow, 'index' | 'raw'>,
    nProductRows: number,
  ): number | null {
    const ri = row.index;
    if (ri >= 0 && ri < nProductRows) return ri;
    if (ri === -1 && Array.isArray(row.raw) && row.raw.length > 0) {
      const num = parseInt(String(row.raw[0]), 10);
      if (Number.isFinite(num) && num >= 1 && num <= nProductRows) return num - 1;
    }
    return null;
  }

  /** Cuentas bancarias de la empresa (campo `bank_accounts`); encima del bloque «Elaborado por». */
  private drawPdfBankAccountsSection(
    doc: jsPDF,
    pageW: number,
    margin: number,
    tableInnerW: number,
    yStart: number,
    bankAccounts: string,
    T: PdfQuotationTheme,
  ): number {
    const text = bankAccounts?.trim();
    if (!text) return yStart;

    let y = yStart + 8;
    const pageH = doc.internal.pageSize.getHeight();
    const ensureSpace = (need: number) => {
      if (y + need > pageH - 18) {
        doc.addPage();
        y = margin + 8;
      }
    };

    doc.setDrawColor(...T.border);
    doc.setLineWidth(0.2);
    ensureSpace(12);
    doc.line(margin, y - 2, pageW - margin, y - 2);
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...T.primary);
    doc.text('Cuentas bancarias', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...T.textBody);

    const paragraphs = text.split(/\r?\n/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        y += 2;
        continue;
      }
      const lines = doc.splitTextToSize(trimmed, tableInnerW);
      for (const line of lines) {
        ensureSpace(5);
        doc.text(line, margin, y);
        y += 4.1;
      }
      y += 1;
    }
    return y;
  }

  /**
   * Pie centrado: usuario que creó la cotización e icono (SVG rasterizado).
   * Salta de página si no cabe encima del texto legal.
   */
  private drawPdfQuotationCreatorFooter(
    doc: jsPDF,
    pageW: number,
    margin: number,
    yStart: number,
    row: QuotationRow,
    creator: AdminUser | null,
    creatorIconPng: string | null,
    T: PdfQuotationTheme,
  ): number {
    let y = yStart + 10;
    const pageH = doc.internal.pageSize.getHeight();
    const reserveBottom = 22;
    const blockMin = 34;
    if (y + blockMin > pageH - reserveBottom) {
      doc.addPage();
      y = margin + 8;
    }

    const cx = pageW / 2;
    doc.setDrawColor(...T.border);
    doc.setLineWidth(0.2);
    doc.line(margin + 28, y, pageW - margin - 28, y);
    y += 9;

    const iconMm = 11;
    if (creatorIconPng) {
      try {
        doc.addImage(creatorIconPng, 'PNG', cx - iconMm / 2, y, iconMm, iconMm);
      } catch {
        /* icono opcional */
      }
      y += iconMm + 5;
    } else {
      y += 2;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...T.primary);
    doc.text('Elaborado por', cx, y, { align: 'center' });
    y += 5;

    const displayName =
      creator != null
        ? this.sellerDisplay(creator)
        : row.user > 0
          ? `Usuario #${row.user}`
          : '—';
    doc.setFontSize(10);
    doc.setTextColor(...T.totalBar);
    doc.text(displayName, cx, y, { align: 'center' });
    y += 5.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...T.muted);
    if (creator?.email?.trim()) {
      doc.text(creator.email.trim(), cx, y, { align: 'center' });
      y += 4.3;
    }
    if (creator?.cellphone?.trim()) {
      doc.text(`Tel. ${creator.cellphone.trim()}`, cx, y, { align: 'center' });
      y += 4.3;
    }
    if (creator?.username) {
      doc.text(`Usuario: ${creator.username}`, cx, y, { align: 'center' });
      y += 4.3;
    }
    const role = creator?.profile?.role;
    if (role) {
      doc.text(this.roleLabelPdf(role), cx, y, { align: 'center' });
      y += 4.3;
    }

    return y;
  }

  private generateQuotationPdf(
    row: QuotationRow,
    T: PdfQuotationTheme,
    logoDataUrl: string | null = null,
    sellerLabel: string = '—',
    productImages: Map<number, string | null> = new Map(),
    bankAccounts: string = '',
    creatorUser: AdminUser | null = null,
    creatorIconPng: string | null = null,
  ): void {
    const doc = new jsPDF();
    const margin = 16;
    const pageW = doc.internal.pageSize.getWidth();
    const tableInnerW = pageW - 2 * margin;
    let y = 14;

    if (logoDataUrl) {
      try {
        this.addCompanyLogoToPdf(doc, logoDataUrl, pageW, margin);
      } catch {
        /* logo opcional */
      }
    }

    const client = this.clients().find((c) => c.id === row.client);
    const pay = this.paymentMethods().find((p) => p.id === row.payment_methods);
    const typeLabel = this.typeOpts.find((o) => o.value === row.quotation_type)?.label ?? row.quotation_type;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...T.primary);
    doc.text('Cotización', margin, y);
    doc.setTextColor(...T.totalBar);
    doc.text(`  ${row.correlativo}`, margin + doc.getTextWidth('Cotización'), y);
    y += 4;
    doc.setDrawColor(...T.primary);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...T.primary);
    doc.text('Cliente', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...T.totalBar);
    y += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.text(client?.name ?? `#${row.client}`, margin, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
    doc.setTextColor(...T.muted);
    doc.text(`RUC ${client?.ruc?.trim() ? client.ruc : '—'}`, margin, y);
    y += 6;

    const metaLine = (label: string, value: string) => {
      doc.setTextColor(...T.muted);
      doc.text(label, margin, y);
      const lw = doc.getTextWidth(`${label} `);
      doc.setTextColor(...T.totalBar);
      doc.text(value, margin + lw, y);
      y += 5;
    };
    metaLine('Tipo', typeLabel);
    metaLine('Moneda', row.money);
    if (row.money === 'PEN') {
      const ex = this.exchangeRateFromRow(row);
      metaLine('Tipo de cambio (PEN/USD)', ex != null ? String(ex) : '—');
    }
    metaLine('Plazo de entrega', this.deliveryTimePdfLabel(row.delivery_time));
    if (row.creation_date) {
      metaLine('Emitido el', this.formatQuotationDatePdf(row.creation_date));
    }
    metaLine('Vendedor', sellerLabel);
    y += 4;

    const lines = this.linesForQuotationId(row.id);
    const showSku = row.see_sku;
    const money = row.money;
    const descIdx = showSku ? 2 : 1;
    const col = showSku
      ? { num: 9, sku: 26, desc: 72, cant: 12, pUnit: 30, pTot: 33 }
      : { num: 9, desc: 98, cant: 12, pUnit: 31, pTot: 32 };
    /** Anchos relativos (9+26+72+… y 9+98+…) suman 182 en ambos modos. */
    const colSum = 182;
    const descColWidthMm = (tableInnerW * col.desc) / colSum;

    const head = showSku
      ? [['#', 'Nro. Parte', 'Descripción', 'Cant.', 'P.Unit.', 'P.Total']]
      : [['#', 'Descripción', 'Cant.', 'P.Unit.', 'P.Total']];
    /** Texto de descripción se dibuja en `didDrawCell`; placeholder para no duplicar. */
    const lineBody: string[][] = lines.map((line, idx) => {
      const sku = this.productLineLabel(line);
      const pu = Number(line.product_price);
      const subt = line.cant * pu;
      const item = String(idx + 1);
      const puStr = this.formatMoneyPdfPlain(pu);
      const subStr = this.formatMoneyPdfPlain(subt);
      if (showSku) {
        return [item, sku, ' ', String(line.cant), puStr, subStr];
      }
      return [item, ' ', String(line.cant), puStr, subStr];
    });

    const subtotal = this.subtotalForQuotationId(row.id);
    const disc = Number(row.discount);
    const baseImponible = Math.max(0, subtotal - disc);
    const igv = baseImponible * 0.18;
    const totalConIgv = baseImponible + igv;

    const labelSpan = showSku ? 5 : 4;
    const sumFont = 9;
    const sumPad = { top: 3.5, bottom: 3, left: 2, right: 2 };
    const sumTopPad = { ...sumPad, top: 6 };
    const sumRowStyle = {
      halign: 'right' as const,
      fontSize: sumFont,
      cellPadding: sumTopPad,
      fillColor: T.primaryLight,
      textColor: T.totalBar,
      fontStyle: 'bold' as const,
    };
    const sumRowStylePad = {
      halign: 'right' as const,
      fontSize: sumFont,
      cellPadding: sumPad,
      fillColor: T.primaryLight,
      textColor: T.totalBar,
      fontStyle: 'bold' as const,
    };

    /** Misma tabla: líneas + totales con colSpan (sin segunda tabla suelta). */
    const summaryRows: RowInput[] = [];
    if (disc > 0) {
      summaryRows.push(
        [
          {
            content: 'Subtotal',
            colSpan: labelSpan,
            styles: { ...sumRowStyle },
          },
          {
            content: this.formatMoneyPdf(money, subtotal),
            styles: { ...sumRowStyle },
          },
        ],
        [
          {
            content: 'Descuento',
            colSpan: labelSpan,
            styles: { ...sumRowStylePad },
          },
          {
            content: `- ${this.formatMoneyPdf(money, disc)}`,
            styles: { ...sumRowStylePad },
          },
        ],
      );
    }
    summaryRows.push(
      [
        {
          content: 'Valor Venta',
          colSpan: labelSpan,
          styles: {
            halign: 'right',
            fontSize: sumFont,
            cellPadding: disc > 0 ? sumPad : sumTopPad,
            fillColor: T.primaryLight,
            textColor: T.totalBar,
            fontStyle: 'bold',
          },
        },
        {
          content: this.formatMoneyPdf(money, baseImponible),
          styles: {
            halign: 'right',
            fontSize: sumFont,
            cellPadding: disc > 0 ? sumPad : sumTopPad,
            fillColor: T.primaryLight,
            textColor: T.totalBar,
            fontStyle: 'bold',
          },
        },
      ],
      [
        {
          content: 'I.G.V. (18%)',
          colSpan: labelSpan,
          styles: {
            halign: 'right',
            fontSize: sumFont,
            cellPadding: sumPad,
            fillColor: T.primaryLight,
            textColor: T.totalBar,
            fontStyle: 'bold',
          },
        },
        {
          content: this.formatMoneyPdf(money, igv),
          styles: {
            halign: 'right',
            fontSize: sumFont,
            cellPadding: sumPad,
            fillColor: T.primaryLight,
            textColor: T.totalBar,
            fontStyle: 'bold',
          },
        },
      ],
      [
        {
          content: 'Venta Total',
          colSpan: labelSpan,
          styles: {
            halign: 'right',
            fontSize: 10,
            fontStyle: 'bold',
            fillColor: T.totalBar,
            textColor: T.white,
            cellPadding: { ...sumPad, top: 4, bottom: 4 },
          },
        },
        {
          content: this.formatMoneyPdf(money, totalConIgv),
          styles: {
            halign: 'right',
            fontSize: 10,
            fontStyle: 'bold',
            fillColor: T.totalBar,
            textColor: T.white,
            cellPadding: { ...sumPad, top: 4, bottom: 4 },
          },
        },
      ],
    );

    const body: RowInput[] = [...lineBody, ...summaryRows];

    const nProductRows = lineBody.length;

    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: 'plain',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 3.5, bottom: 3.5, left: 2, right: 2 },
        valign: 'middle',
        lineColor: T.border,
        lineWidth: 0.15,
        textColor: [...T.totalBar],
      },
      headStyles: {
        fillColor: T.primary,
        textColor: T.white,
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
        valign: 'middle',
        lineWidth: 0,
        cellPadding: { top: 4, bottom: 4, left: 2, right: 2 },
      },
      columnStyles: showSku
        ? {
            0: { cellWidth: col.num },
            1: { cellWidth: col.sku },
            2: { cellWidth: col.desc },
            3: { cellWidth: col.cant },
            4: { cellWidth: col.pUnit },
            5: { cellWidth: col.pTot },
          }
        : {
            0: { cellWidth: col.num },
            1: { cellWidth: col.desc },
            2: { cellWidth: col.cant },
            3: { cellWidth: col.pUnit },
            4: { cellWidth: col.pTot },
          },
      margin: { left: margin, right: margin },
      tableWidth: tableInnerW,
      /** Fila completa a la página siguiente si no cabe; evita partir celdas con descripción/ficha dibujada a mano. */
      rowPageBreak: 'avoid',
      didParseCell: (data) => {
        if (data.section === 'head') {
          data.cell.styles.halign = 'center';
          return;
        }
        if (data.section !== 'body' || data.column.index == null) return;
        const lineIdx = this.resolveQuotationPdfProductLineIndex(data.row, nProductRows);
        if (lineIdx != null) {
          if (data.column.index === descIdx) {
            const qLine = lines[lineIdx];
            if (qLine) {
              data.cell.styles.minCellHeight = this.estimatePdfDescCellHeight(
                doc,
                qLine,
                descColWidthMm,
                productImages,
                T,
              );
              data.cell.styles.valign = 'top';
            }
          }
          if (lineIdx % 2 === 1) {
            data.cell.styles.fillColor = T.stripe;
          }
          const i = data.column.index;
          if (showSku) {
            if (i >= 4) data.cell.styles.halign = 'right';
            else if (i === 0 || i === 3) data.cell.styles.halign = 'center';
            else data.cell.styles.halign = 'left';
          } else {
            if (i >= 3) data.cell.styles.halign = 'right';
            else if (i === 0 || i === 2) data.cell.styles.halign = 'center';
            else data.cell.styles.halign = 'left';
          }
        }
      },
      willDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== descIdx) return;
        const lineIdx = this.resolveQuotationPdfProductLineIndex(data.row, nProductRows);
        if (lineIdx != null) {
          data.cell.text = [];
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== descIdx) return;
        const lineIdx = this.resolveQuotationPdfProductLineIndex(data.row, nProductRows);
        if (lineIdx == null) return;
        const qLine = lines[lineIdx];
        if (!qLine) return;
        const cell = data.cell;
        const padL = cell.padding('left');
        const padT = cell.padding('top');
        const padR = cell.padding('right');
        const imgData = productImages.get(qLine.product);
        const hasImg = !!imgData;
        const left = cell.x + padL;
        const textW = Math.max(18, cell.width - padL - padR);
        /** No dibujar más allá del borde inferior de la celda (respaldo si la tabla partiera una fila). */
        const maxY = cell.y + cell.height - cell.padding('bottom');
        let cy = cell.y + padT + 3.3;
        const main = this.productLineDescription(qLine);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...T.totalBar);
        doc.setFontSize(8.5);
        const mainLines = doc.splitTextToSize(main, textW);
        for (const ml of mainLines) {
          if (cy > maxY) break;
          doc.text(ml, left, cy);
          cy += 4.1;
        }
        const ds = this.lineDatasheetForPdf(qLine);
        if (ds) {
          cy += 1.2;
          if (cy <= maxY) {
            doc.setFont('times', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(...T.textLabel);
            doc.text('Ficha técnica', left, cy);
            cy += 4;
            doc.setFont('times', 'italic');
            doc.setFontSize(7);
            doc.setTextColor(...T.textCaption);
            for (const dl of doc.splitTextToSize(ds, textW)) {
              if (cy > maxY) break;
              doc.text(dl, left, cy);
              cy += 3.5;
            }
          }
        }
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...T.totalBar);
        if (hasImg && imgData) {
          try {
            cy += 3;
            const fmt: 'PNG' | 'JPEG' = imgData.includes('image/jpeg') ? 'JPEG' : 'PNG';
            let { w: dw, h: dh } = this.pdfDescImageDisplayMm(doc, imgData, textW);
            const room = maxY - cy;
            if (room < 4) {
              /* sin espacio para imagen */
            } else if (dh > room) {
              const scale = room / dh;
              dw *= scale;
              dh = room;
              doc.addImage(imgData, fmt, left, cy, dw, dh);
            } else {
              doc.addImage(imgData, fmt, left, cy, dw, dh);
            }
          } catch {
            /* imagen opcional */
          }
        }
      },
    });

    const lastY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    y = (lastY ?? y + 24) + 12;

    doc.setDrawColor(...T.border);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 4, pageW - margin, y - 4);
    y += 2;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...T.primary);
    doc.text('Condiciones comerciales', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...T.muted);
    doc.text(`Método de pago: `, margin, y);
    doc.setTextColor(...T.totalBar);
    doc.text(pay?.name ?? '—', margin + doc.getTextWidth('Método de pago: '), y);
    y += 7;

    const cond = row.conditions?.trim();
    if (cond) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...T.primary);
      doc.text('Condiciones', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...T.textBody);
      y += 4.5;
      const condBody = doc.splitTextToSize(cond, tableInnerW);
      doc.text(condBody, margin, y);
      y += condBody.length * 4.2 + 5;
    }

    const works = row.works?.trim();
    if (works) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...T.primary);
      doc.text('Trabajos / alcance', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...T.textBody);
      y += 4.5;
      const worksBody = doc.splitTextToSize(works, tableInnerW);
      doc.text(worksBody, margin, y);
      y += worksBody.length * 4.2 + 5;
    }

    y = this.drawPdfBankAccountsSection(doc, pageW, margin, tableInnerW, y, bankAccounts, T);
    y = this.drawPdfQuotationCreatorFooter(
      doc,
      pageW,
      margin,
      y,
      row,
      creatorUser,
      creatorIconPng,
      T,
    );

    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(...T.muted);
    doc.text(
      'Documento generado por CleoSystem',
      margin,
      pageH - 10,
      { maxWidth: tableInnerW },
    );

    const safeName = row.correlativo.replace(/[^\w.-]+/g, '_');
    doc.save(`cotizacion-${safeName}.pdf`);
  }

  /** Importe con símbolo según moneda (resúmenes y textos del PDF). */
  private formatMoneyPdf(money: 'PEN' | 'USD', n: number): string {
    const num = n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return money === 'PEN' ? `S/ ${num}` : `US$ ${num}`;
  }

  /** Cifras en celdas de la tabla de líneas (sin símbolo en cada celda; el resumen lleva moneda). */
  private formatMoneyPdfPlain(n: number): string {
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Plazo de entrega en PDF: 0 días se muestra como Stock Inmediato. */
  private deliveryTimePdfLabel(days: number): string {
    if (days === 0) return 'Stock Inmediato';
    return `${days} día(s)`;
  }

  /** Fecha legible para el PDF (sin etiqueta «Creado»). */
  private formatQuotationDatePdf(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-PE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es');
  }

  formatMoney(n: number): string {
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Muestra el % sin forzar siempre dos decimales. */
  formatPercent(v: number | null | undefined): string {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('es-PE', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  }

  /** Texto de ayuda bajo el selector de vendedor (admin). */
  sellerEligibilityHint(): string {
    if (!this.auth.isAdmin()) return '';
    if (this.sellerContactsLoading()) return 'Cargando contactos del cliente…';
    if (this.sellerHasContacts() && this.sellerEligibleIdsFromContacts().size === 0) {
      return 'Este cliente tiene contactos pero ninguno tiene vendedor asignado. Asigne un vendedor en Contactos del cliente.';
    }
    if (!this.sellerHasContacts()) {
      return 'Cliente sin contactos: puede elegir cualquier usuario con rol Ventas. La regla definitiva debe validarla el servidor.';
    }
    return 'Solo aparecen vendedores asignados a algún contacto de este cliente.';
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;
        const label: Record<string, string> = {
          user: 'Usuario (vendedor)',
          exchange_rate: 'Tipo de cambio',
          client: 'Cliente',
          money: 'Moneda',
          conditions: 'Condiciones',
          works: 'Trabajos / alcance',
          payment_methods: 'Método de pago',
          quotation_type: 'Tipo de cotización',
          discount: 'Descuento',
          final_price: 'Total',
        };
        const parts: string[] = [];
        for (const [key, val] of Object.entries(d)) {
          if (key === 'detail') continue;
          const name = label[key] ?? key;
          if (Array.isArray(val)) {
            for (const msg of val) {
              if (typeof msg === 'string') parts.push(`${name}: ${msg}`);
            }
          } else if (typeof val === 'string') {
            parts.push(`${name}: ${val}`);
          }
        }
        if (parts.length) return parts.join(' · ');
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
