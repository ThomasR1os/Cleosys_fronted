import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, lastValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { SupplierService } from '../../../core/services/supplier.service';
import type { Supplier } from '../../../core/models/supplier.model';
import type { AlmacenProduct } from '../../../almacen/models/almacen.models';
import { AlmacenProductService } from '../../../almacen/services/almacen-product.service';
import type { ProductSupplierMoney, ProductSupplierRow } from '../../models/logistica.models';
import { ProductSupplierService } from '../../services/product-supplier.service';
import {
  downloadProductSupplierExcelTemplate,
  productSupplierBulkChunkSize,
  readProductSupplierExcel,
  type ProductSupplierExcelIssue,
} from './product-supplier-excel.util';

/** Vacío es válido (null). 0 es entrega inmediata. Decimales y negativos no. */
function leadDaysValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value == null || value === '') return null;
  const days = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
    return { leadDays: true };
  }
  return null;
}

@Component({
  selector: 'app-product-suppliers-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './product-suppliers-page.component.html',
})
export class ProductSuppliersPageComponent implements OnInit {
  private readonly api = inject(ProductSupplierService);
  private readonly productsApi = inject(AlmacenProductService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<ProductSupplierRow[]>([]);
  readonly products = signal<AlmacenProduct[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly importBusy = signal(false);
  readonly importProgress = signal<{ done: number; total: number } | null>(null);
  readonly importSummary = signal<{
    created: number;
    updated: number;
    failed: number;
    errors: ProductSupplierExcelIssue[];
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly filterProductId = signal<number | null>(null);
  readonly filterSupplierId = signal<number | null>(null);
  readonly filterProductQuery = signal('');
  readonly filterSupplierQuery = signal('');
  readonly filterProductMenuOpen = signal(false);
  readonly filterSupplierMenuOpen = signal(false);

  readonly productQuery = signal('');
  readonly supplierQuery = signal('');
  readonly productMenuOpen = signal(false);
  readonly supplierMenuOpen = signal(false);
  readonly modalProductId = signal(0);
  readonly modalSupplierId = signal(0);

  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly filteredItems = computed(() => {
    let rows = this.items();
    const fp = this.filterProductId();
    const fs = this.filterSupplierId();
    if (fp != null) rows = rows.filter((r) => r.product === fp);
    if (fs != null) rows = rows.filter((r) => r.supplier === fs);
    return rows;
  });

  readonly totalCount = computed(() => this.filteredItems().length);
  readonly totalPages = computed(() => {
    const count = this.totalCount();
    if (count === 0) return 0;
    return Math.ceil(count / this.pageSize());
  });
  readonly pagedItems = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredItems().slice(start, start + this.pageSize());
  });
  readonly rangeStart = computed(() => (this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1));
  readonly rangeEnd = computed(() => Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()));

  readonly hasFilters = computed(() => this.filterProductId() != null || this.filterSupplierId() != null);

  readonly filterProductMatches = computed(() =>
    this.matchProducts(this.filterProductQuery(), this.filterProductId()),
  );
  readonly filterSupplierMatches = computed(() =>
    this.matchSuppliers(this.filterSupplierQuery(), this.filterSupplierId()),
  );
  readonly modalProductMatches = computed(() => this.matchProducts(this.productQuery(), this.modalProductId()));
  readonly modalSupplierMatches = computed(() =>
    this.matchSuppliers(this.supplierQuery(), this.modalSupplierId()),
  );

  readonly productLabel = computed(() => {
    const m = new Map<number, string>();
    for (const p of this.products()) {
      m.set(p.id, this.productChoiceLabel(p));
    }
    return m;
  });

  readonly supplierLabel = computed(() => {
    const m = new Map<number, string>();
    for (const s of this.suppliers()) {
      m.set(s.id, s.name);
    }
    return m;
  });

  readonly moneyOptions: { value: ProductSupplierMoney; label: string }[] = [
    { value: 'PEN', label: 'PEN' },
    { value: 'USD', label: 'USD' },
  ];

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    product: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    supplier: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    money: this.fb.nonNullable.control<ProductSupplierMoney>('PEN', Validators.required),
    cost: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(0)]),
    incoterm: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(3),
      Validators.pattern(/^[A-Z]{3}$/),
    ]),
    estimated_lead_time_days: this.fb.control<number | null>(null, leadDaysValidator),
  });

  constructor() {
    this.form.controls.incoterm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const next = this.normalizeIncoterm(value);
      if (value !== next) {
        this.form.controls.incoterm.setValue(next, { emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      ps: this.api.list(),
      pr: this.productsApi.list(),
      sup: this.suppliersApi.list(),
    }).subscribe({
      next: ({ ps, pr, sup }) => {
        this.items.set(ps);
        this.products.set([...pr].sort((a, b) => a.sku.localeCompare(b.sku, 'es')));
        this.suppliers.set([...sup].sort((a, b) => a.name.localeCompare(b.name, 'es')));
        this.loading.set(false);
        this.clampPage();
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  onFilterProductQuery(value: string): void {
    this.filterProductQuery.set(value);
    this.filterProductMenuOpen.set(true);
    const selected = this.products().find((product) => product.id === this.filterProductId());
    const label = selected ? this.productChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.filterProductId.set(null);
      this.pageIndex.set(0);
    }
  }

  onFilterSupplierQuery(value: string): void {
    this.filterSupplierQuery.set(value);
    this.filterSupplierMenuOpen.set(true);
    const selected = this.suppliers().find((supplier) => supplier.id === this.filterSupplierId());
    const label = selected ? this.supplierChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.filterSupplierId.set(null);
      this.pageIndex.set(0);
    }
  }

  closeFilterProductMenuSoon(): void {
    window.setTimeout(() => this.filterProductMenuOpen.set(false), 180);
  }

  closeFilterSupplierMenuSoon(): void {
    window.setTimeout(() => this.filterSupplierMenuOpen.set(false), 180);
  }

  pickFilterProduct(product: AlmacenProduct | null, event?: Event): void {
    event?.preventDefault();
    this.filterProductMenuOpen.set(false);
    if (!product) {
      this.filterProductQuery.set('');
      this.filterProductId.set(null);
    } else {
      this.filterProductQuery.set(this.productChoiceLabel(product));
      this.filterProductId.set(product.id);
    }
    this.pageIndex.set(0);
  }

  pickFilterSupplier(supplier: Supplier | null, event?: Event): void {
    event?.preventDefault();
    this.filterSupplierMenuOpen.set(false);
    if (!supplier) {
      this.filterSupplierQuery.set('');
      this.filterSupplierId.set(null);
    } else {
      this.filterSupplierQuery.set(this.supplierChoiceLabel(supplier));
      this.filterSupplierId.set(supplier.id);
    }
    this.pageIndex.set(0);
  }

  clearFilters(): void {
    this.filterProductId.set(null);
    this.filterSupplierId.set(null);
    this.filterProductQuery.set('');
    this.filterSupplierQuery.set('');
    this.pageIndex.set(0);
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

  downloadTemplate(): void {
    downloadProductSupplierExcelTemplate();
  }

  async onExcelFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.importSummary.set(null);
    this.importProgress.set(null);
    this.errorMessage.set(null);
    this.importBusy.set(true);
    try {
      const parsed = readProductSupplierExcel(await file.arrayBuffer());
      if (!parsed.ok) {
        this.errorMessage.set(parsed.error);
        return;
      }

      const errors = [...parsed.errors];
      if (!parsed.items.length) {
        this.importSummary.set({ created: 0, updated: 0, failed: errors.length, errors });
        return;
      }

      let created = 0;
      let updated = 0;
      const chunkSize = productSupplierBulkChunkSize();
      const totalChunks = Math.ceil(parsed.items.length / chunkSize);
      for (let offset = 0; offset < parsed.items.length; offset += chunkSize) {
        const chunkIndex = Math.floor(offset / chunkSize);
        this.importProgress.set({ done: chunkIndex + 1, total: totalChunks });
        const chunk = parsed.items.slice(offset, offset + chunkSize);
        try {
          const res = await lastValueFrom(
            this.api.bulkUpsert({
              mode: 'upsert',
              items: chunk.map((row) => row.item),
            }),
          );
          created += Number(res.created) || 0;
          updated += Number(res.updated) || 0;
          for (const issue of res.errors ?? []) {
            const source = chunk[issue.index];
            const sku = issue.sku || source?.item.sku || '(sin sku)';
            const ruc = issue.supplier_ruc || source?.item.supplier_ruc || '';
            errors.push({
              label: source ? `Fila ${source.excelRow} · ${sku}${ruc ? ` · RUC ${ruc}` : ''}` : sku,
              message: issue.message || 'Error',
            });
          }
        } catch (err: unknown) {
          errors.push({
            label: `Lote ${chunkIndex + 1}`,
            message: formatHttpError(err),
          });
          break;
        }
      }

      this.importSummary.set({ created, updated, failed: errors.length, errors });
      this.reload();
    } finally {
      this.importBusy.set(false);
      this.importProgress.set(null);
      input.value = '';
    }
  }

  openNew(): void {
    this.editingId.set(null);
    this.modalProductId.set(0);
    this.modalSupplierId.set(0);
    this.productQuery.set('');
    this.supplierQuery.set('');
    this.productMenuOpen.set(false);
    this.supplierMenuOpen.set(false);
    this.form.reset({
      id: null,
      product: 0,
      supplier: 0,
      money: 'PEN',
      cost: 0,
      incoterm: '',
      estimated_lead_time_days: null,
    });
    this.modalOpen.set(true);
  }

  openEdit(row: ProductSupplierRow): void {
    const product = this.products().find((item) => item.id === row.product);
    const supplier = this.suppliers().find((item) => item.id === row.supplier);
    this.editingId.set(row.id);
    this.modalProductId.set(row.product);
    this.modalSupplierId.set(row.supplier);
    this.productQuery.set(product ? this.productChoiceLabel(product) : String(row.product));
    this.supplierQuery.set(supplier ? this.supplierChoiceLabel(supplier) : String(row.supplier));
    this.productMenuOpen.set(false);
    this.supplierMenuOpen.set(false);
    this.form.reset({
      id: row.id,
      product: row.product,
      supplier: row.supplier,
      money: row.money,
      cost: Number(row.cost),
      incoterm: this.normalizeIncoterm(row.incoterm),
      estimated_lead_time_days: row.estimated_lead_time_days,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.productMenuOpen.set(false);
    this.supplierMenuOpen.set(false);
    this.modalOpen.set(false);
  }

  onProductQuery(value: string): void {
    this.productQuery.set(value);
    this.productMenuOpen.set(true);
    const selected = this.products().find((product) => product.id === this.modalProductId());
    const label = selected ? this.productChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.modalProductId.set(0);
      this.form.controls.product.setValue(0);
      this.form.controls.product.markAsDirty();
    }
  }

  onSupplierQuery(value: string): void {
    this.supplierQuery.set(value);
    this.supplierMenuOpen.set(true);
    const selected = this.suppliers().find((supplier) => supplier.id === this.modalSupplierId());
    const label = selected ? this.supplierChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.modalSupplierId.set(0);
      this.form.controls.supplier.setValue(0);
      this.form.controls.supplier.markAsDirty();
    }
  }

  closeProductMenuSoon(): void {
    window.setTimeout(() => this.productMenuOpen.set(false), 180);
  }

  closeSupplierMenuSoon(): void {
    window.setTimeout(() => this.supplierMenuOpen.set(false), 180);
  }

  pickProduct(product: AlmacenProduct, event?: Event): void {
    event?.preventDefault();
    this.productQuery.set(this.productChoiceLabel(product));
    this.productMenuOpen.set(false);
    this.modalProductId.set(product.id);
    this.form.controls.product.setValue(product.id);
    this.form.controls.product.markAsDirty();
  }

  pickSupplier(supplier: Supplier, event?: Event): void {
    event?.preventDefault();
    this.supplierQuery.set(this.supplierChoiceLabel(supplier));
    this.supplierMenuOpen.set(false);
    this.modalSupplierId.set(supplier.id);
    this.form.controls.supplier.setValue(supplier.id);
    this.form.controls.supplier.markAsDirty();
  }

  save(): void {
    const incoterm = this.normalizeIncoterm(this.form.controls.incoterm.value);
    if (this.form.controls.incoterm.value !== incoterm) {
      this.form.controls.incoterm.setValue(incoterm);
    }
    if (this.form.invalid || this.modalProductId() <= 0 || this.modalSupplierId() <= 0) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);
    const id = this.editingId();
    const payload: Record<string, unknown> = {
      product: v.product,
      supplier: v.supplier,
      money: v.money,
      cost: v.cost,
      incoterm,
      estimated_lead_time_days: this.leadDaysOrNull(v.estimated_lead_time_days),
    };
    if (id == null && v.id != null) {
      payload['id'] = v.id;
    }
    const req =
      id == null
        ? this.api.create(payload as Partial<ProductSupplierRow>)
        : this.api.update(id, payload as Partial<ProductSupplierRow>);
    req.subscribe({
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

  /** Vacío → null (borra el plazo). 0 se conserva. */
  private leadDaysOrNull(v: number | null | ''): number | null {
    if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return null;
    return v;
  }

  remove(row: ProductSupplierRow): void {
    if (!window.confirm(`¿Eliminar la relación #${row.id}?`)) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  private matchProducts(query: string, selectedId: number | null): AlmacenProduct[] {
    const selected = this.products().find((product) => product.id === selectedId);
    const selectedLabel = selected ? this.productChoiceLabel(selected) : '';
    return this.products()
      .filter((product) =>
        this.matchesLookup(`${product.sku} ${product.description} ${product.id}`, query, selectedLabel),
      )
      .slice(0, 20);
  }

  private matchSuppliers(query: string, selectedId: number | null): Supplier[] {
    const selected = this.suppliers().find((supplier) => supplier.id === selectedId);
    const selectedLabel = selected ? this.supplierChoiceLabel(selected) : '';
    return this.suppliers()
      .filter((supplier) =>
        this.matchesLookup(
          `${supplier.name} ${supplier.ruc} ${supplier.type === 'EXTRANJERO' ? 'extranjero' : 'nacional'}`,
          query,
          selectedLabel,
        ),
      )
      .slice(0, 20);
  }

  private matchesLookup(haystack: string, query: string, selectedLabel: string): boolean {
    const text = query.trim();
    if (!text || text === selectedLabel.trim()) return true;
    return textMatchesLooseQuery(haystack, text);
  }

  private productChoiceLabel(product: AlmacenProduct): string {
    return `${product.sku} — ${product.description}`;
  }

  private supplierChoiceLabel(supplier: Supplier): string {
    const ruc = supplier.ruc?.trim();
    return ruc ? `${supplier.name} · ${ruc}` : supplier.name;
  }

  private normalizeIncoterm(value: string | null | undefined): string {
    return String(value ?? '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
  }

  private clampPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex() > last) this.pageIndex.set(last);
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && 'detail' in d && typeof d.detail === 'string') {
        return d.detail;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
