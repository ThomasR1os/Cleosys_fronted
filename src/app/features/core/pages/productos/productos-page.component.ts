import { HttpErrorResponse } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth.service';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import type { Product } from '../../../almacen/models/almacen.models';
import { ProductImageService } from '../../../almacen/services/product-image.service';
import { ProductService } from '../../../almacen/services/product.service';
import {
  downloadProductExcelTemplate,
  excelRowToBulkItem,
  parseProductExcel,
} from './product-excel-import.util';
import {
  imageUrlToDataUrl,
  openProductFichaPdf,
  type FichaPdfParam,
} from './product-ficha-pdf.util';

/** Estado de la verificación de SKU al dejar de escribir. */
type SkuCheckStatus = 'idle' | 'checking' | 'available' | 'exists';


const BULK_UPSERT_CHUNK_SIZE = 500;

type CatalogRow = { id: number; name: string };

type SubcategoryRow = CatalogRow & { category: number };

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

@Component({
  selector: 'app-productos-page',
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe],
  templateUrl: './productos-page.component.html',
})
export class ProductosPageComponent implements OnInit {
  private readonly api = inject(ProductService);
  private readonly imagesApi = inject(ProductImageService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  readonly items = signal<Product[]>([]);
  /** Búsqueda en cliente (SKU, descripción, ID, catálogo, estado, precio). */
  readonly searchQuery = signal('');
  readonly filterCategoryId = signal<number | null>(null);
  readonly filterSubcategoryId = signal<number | null>(null);
  readonly filterBrandId = signal<number | null>(null);
  readonly filterTypeId = signal<number | null>(null);
  readonly filterStatus = signal<StatusFilter>('ACTIVE');
  readonly togglingStatusId = signal<number | null>(null);
  readonly pageSize = signal(10);
  /** Página 1-based. */
  readonly currentPage = signal(1);

  readonly filterSubcategoryOptions = computed(() => {
    const catId = this.filterCategoryId();
    const subs = this.subcategories();
    if (catId == null) return subs;
    return subs.filter((s) => Number(s.category) === Number(catId));
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery();
    const catId = this.filterCategoryId();
    const subId = this.filterSubcategoryId();
    const brandId = this.filterBrandId();
    const typeId = this.filterTypeId();
    const status = this.filterStatus();
    const catById = new Map(this.categories().map((c) => [c.id, c.name]));
    const subById = new Map(this.subcategories().map((s) => [s.id, s.name]));
    const brandById = new Map(this.brands().map((b) => [b.id, b.name]));
    const typeById = new Map(this.types().map((t) => [t.id, t.name]));

    return this.items().filter((p) => {
      if (catId != null && this.resolveProductCategoryId(p) !== catId) return false;
      if (subId != null && this.coerceFk(p.subcategory) !== subId) return false;
      if (brandId != null && this.coerceFk(p.brand) !== brandId) return false;
      if (typeId != null && this.coerceFk(p.type) !== typeId) return false;
      if (status !== 'ALL' && (p.status || 'ACTIVE') !== status) return false;
      if (!q.trim()) return true;
      const blob = [
        String(p.id),
        p.sku,
        p.description,
        p.status ?? '',
        p.price ?? '',
        p.datasheet ?? '',
        p.warranty ?? '',
        catById.get(this.resolveProductCategoryId(p) ?? -1) ?? p.category_name ?? '',
        subById.get(this.coerceFk(p.subcategory) ?? -1) ?? '',
        brandById.get(this.coerceFk(p.brand) ?? -1) ?? '',
        typeById.get(this.coerceFk(p.type) ?? -1) ?? '',
      ].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

  readonly totalFiltered = computed(() => this.filteredItems().length);

  readonly hasActiveFilters = computed(() => {
    return (
      !!this.searchQuery().trim() ||
      this.filterCategoryId() != null ||
      this.filterSubcategoryId() != null ||
      this.filterBrandId() != null ||
      this.filterTypeId() != null ||
      this.filterStatus() !== 'ACTIVE'
    );
  });

  readonly totalPages = computed(() => {
    const n = this.totalFiltered();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(n / size) || 1);
  });

  readonly pagedItems = computed(() => {
    const list = this.filteredItems();
    const size = this.pageSize();
    const page = this.currentPage();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  readonly rangeLabel = computed(() => {
    const total = this.totalFiltered();
    if (total === 0) return '0 resultados';
    const size = this.pageSize();
    const page = this.currentPage();
    const start = (page - 1) * size + 1;
    const end = Math.min(page * size, total);
    return `${start}–${end} de ${total}`;
  });

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly importBusy = signal(false);
  readonly importProgress = signal<{ done: number; total: number } | null>(null);
  readonly importSummary = signal<{
    created: number;
    updated: number;
    failed: number;
    errors: { sku: string; message: string }[];
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  /** Producto cuya ficha PDF se está generando. */
  readonly fichaPdfBusyId = signal<number | null>(null);
  /** Resultado de comprobar si el SKU ya existe en el catálogo. */
  readonly skuCheckStatus = signal<SkuCheckStatus>('idle');

  /** Carga masiva: misma imagen para varios productos. */
  readonly bulkImageOpen = signal(false);
  readonly bulkImageBusy = signal(false);
  readonly bulkImageName = signal('');
  readonly bulkImagePrimary = signal(true);
  readonly bulkPickerQuery = signal('');
  readonly bulkSelectedIds = signal<ReadonlySet<number>>(new Set());
  readonly bulkFileName = signal<string | null>(null);
  readonly bulkProgress = signal<{ done: number; total: number } | null>(null);
  readonly bulkSummary = signal<{
    ok: number;
    errors: { sku: string; message: string }[];
  } | null>(null);
  private bulkFile: File | null = null;

  readonly bulkPickerItems = computed(() => {
    const q = this.bulkPickerQuery();
    const list = this.filteredItems();
    if (!q.trim()) return list;
    return list.filter((p) => {
      const blob = [String(p.id), p.sku, p.description].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

  readonly bulkSelectedCount = computed(() => this.bulkSelectedIds().size);

  readonly categories = signal<CatalogRow[]>([]);
  readonly subcategories = signal<SubcategoryRow[]>([]);
  readonly types = signal<CatalogRow[]>([]);
  readonly brands = signal<CatalogRow[]>([]);
  readonly units = signal<CatalogRow[]>([]);

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    sku: ['', Validators.required],
    description: ['', Validators.required],
    category: this.fb.control<number | null>(null),
    subcategory: this.fb.control<number | null>(null),
    type: this.fb.control<number | null>(null),
    brand: this.fb.control<number | null>(null),
    unit_measurement: this.fb.control<number | null>(null),
    datasheet: [''],
    price: this.fb.control<number | null>(null),
    rental_price_without_operator: this.fb.control<number | null>(null),
    rental_price_with_operator: this.fb.control<number | null>(null),
    warranty: [''],
    status: this.fb.nonNullable.control<string>('ACTIVE'),
    dimensions: [''],
    gross_weight: [''],
  });

  readonly statusOptions: { value: string; label: string }[] = [
    { value: 'ACTIVE', label: 'Activo' },
    { value: 'INACTIVE', label: 'Inactivo' },
  ];

  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  constructor() {
    effect(() => {
      const total = this.totalFiltered();
      const size = this.pageSize();
      const maxPage = Math.max(1, Math.ceil(total / size) || 1);
      const cp = this.currentPage();
      if (cp > maxPage) {
        this.currentPage.set(maxPage);
      }
    });

    this.form.controls.sku.valueChanges
      .pipe(
        tap((raw) => {
          if (!this.modalOpen()) {
            this.skuCheckStatus.set('idle');
            return;
          }
          this.skuCheckStatus.set(raw.trim() ? 'checking' : 'idle');
        }),
        debounceTime(450),
        distinctUntilChanged((a, b) => a.trim() === b.trim()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((raw) => {
        if (!this.modalOpen()) {
          this.skuCheckStatus.set('idle');
          return;
        }
        this.evaluateSkuAvailability(raw);
      });
  }

  ngOnInit(): void {
    this.loadCatalog('categories', this.categories);
    this.loadSubcategories();
    this.loadCatalog('types', this.types);
    this.loadCatalog('brands', this.brands);
    this.loadCatalog('units', this.units);
    this.reload();
  }

  /** Comprueba el SKU contra el catálogo cargado (excluye el producto en edición). */
  private evaluateSkuAvailability(raw: string): void {
    const sku = raw.trim();
    if (!sku) {
      this.skuCheckStatus.set('idle');
      return;
    }
    const needle = sku.toLowerCase();
    const editingId = this.editingId();
    const taken = this.items().some(
      (p) => p.sku.trim().toLowerCase() === needle && p.id !== editingId,
    );
    this.skuCheckStatus.set(taken ? 'exists' : 'available');
  }

  private resetSkuCheck(): void {
    this.skuCheckStatus.set('idle');
  }

  private loadCatalog(
    path: string,
    target: ReturnType<typeof signal<CatalogRow[]>>,
  ): void {
    this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/${path}/`).subscribe({
      next: (rows) => {
        target.set(
          rows.map((r) => ({
            id: r['id'] as number,
            name: String(r['name'] ?? r['id']),
          })),
        );
        this.syncFormCategorySubcategory();
      },
      error: () => {
        this.errorMessage.set(`No se pudieron cargar ${path}.`);
      },
    });
  }

  private loadSubcategories(): void {
    this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/subcategories/`).subscribe({
      next: (rows) => {
        const mapped: SubcategoryRow[] = [];
        for (const r of rows) {
          const cat = this.fkFromRow(r, 'category');
          if (cat == null) continue;
          mapped.push({
            id: Number(r['id']),
            name: String(r['name'] ?? r['id']),
            category: cat,
          });
        }
        this.subcategories.set(mapped);
        this.syncFormCategorySubcategory();
      },
      error: () => {
        this.errorMessage.set('No se pudieron cargar subcategorías.');
      },
    });
  }

  /** FK id desde campo plano, string numérico u objeto anidado `{ id }`. */
  private fkFromRow(row: Record<string, unknown>, key: string): number | null {
    const v = row[key] ?? row[`${key}_id`];
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.trim());
      return Number.isNaN(n) ? null : n;
    }
    if (typeof v === 'object' && v !== null && 'id' in v) {
      const n = Number((v as { id: unknown }).id);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  setFilterCategory(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterCategoryId.set(id != null && !Number.isNaN(id) ? id : null);
    const subId = this.filterSubcategoryId();
    if (subId != null) {
      const ok = this.filterSubcategoryOptions().some((s) => s.id === subId);
      if (!ok) this.filterSubcategoryId.set(null);
    }
    this.currentPage.set(1);
  }

  setFilterSubcategory(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterSubcategoryId.set(id != null && !Number.isNaN(id) ? id : null);
    this.currentPage.set(1);
  }

  setFilterBrand(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterBrandId.set(id != null && !Number.isNaN(id) ? id : null);
    this.currentPage.set(1);
  }

  setFilterType(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterTypeId.set(id != null && !Number.isNaN(id) ? id : null);
    this.currentPage.set(1);
  }

  setFilterStatus(value: string): void {
    const next: StatusFilter =
      value === 'ACTIVE' || value === 'INACTIVE' ? value : 'ALL';
    this.filterStatus.set(next);
    this.currentPage.set(1);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.filterCategoryId.set(null);
    this.filterSubcategoryId.set(null);
    this.filterBrandId.set(null);
    this.filterTypeId.set(null);
    this.filterStatus.set('ACTIVE');
    this.currentPage.set(1);
  }

  isProductActive(row: Product): boolean {
    return (row.status || 'ACTIVE') === 'ACTIVE';
  }

  toggleStatus(row: Product): void {
    if (!this.auth.canWriteAlmacen()) return;
    const next = this.isProductActive(row) ? 'INACTIVE' : 'ACTIVE';
    this.togglingStatusId.set(row.id);
    this.errorMessage.set(null);
    this.api.update(row.id, { status: next }).subscribe({
      next: (updated) => {
        this.togglingStatusId.set(null);
        this.items.update((list) =>
          list.map((p) => (p.id === row.id ? { ...p, status: updated.status || next } : p)),
        );
      },
      error: (err) => {
        this.togglingStatusId.set(null);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  setPageSize(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(n);
    this.currentPage.set(1);
  }

  goPage(delta: number): void {
    const next = this.currentPage() + delta;
    const max = this.totalPages();
    this.currentPage.set(Math.min(max, Math.max(1, next)));
  }

  catalogName(list: CatalogRow[], id: number | null): string {
    if (id == null) return '—';
    return list.find((r) => Number(r.id) === Number(id))?.name ?? '—';
  }

  /**
   * Categoría del producto: campo directo, o la de su subcategoría en el catálogo local
   * (el API a menudo solo manda `subcategory` como id plano).
   */
  resolveProductCategoryId(row: Product): number | null {
    const direct = this.coerceFk(row.category);
    if (direct != null) return direct;
    const subId = this.coerceFk(row.subcategory);
    if (subId == null) return null;
    const sub = this.subcategories().find((s) => Number(s.id) === Number(subId));
    return sub != null ? Number(sub.category) : null;
  }

  productCategoryName(row: Product): string {
    const fromCatalog = this.catalogName(this.categories(), this.resolveProductCategoryId(row));
    if (fromCatalog !== '—') return fromCatalog;
    const embedded = row.category_name?.trim();
    return embedded || '—';
  }

  productBrandName(row: Product): string {
    return this.catalogName(this.brands(), this.coerceFk(row.brand));
  }

  statusLabel(status: string): string {
    if (status === 'ACTIVE') return 'Activo';
    if (status === 'INACTIVE') return 'Inactivo';
    return status;
  }

  hasFichaTecnica(row: Product): boolean {
    return !!(
      row.datasheet?.trim() ||
      row.warranty?.trim() ||
      row.dimensions?.trim() ||
      row.gross_weight?.trim()
    );
  }

  async openFicha(row: Product): Promise<void> {
    if (!this.hasFichaTecnica(row) || this.fichaPdfBusyId() != null) return;
    this.fichaPdfBusyId.set(row.id);
    this.errorMessage.set(null);
    try {
      let imageDataUrl: string | null = null;
      try {
        const imgs = await firstValueFrom(this.imagesApi.listForProduct(row.id));
        const pick = imgs.find((i) => i.primary && i.url?.trim()) ?? imgs.find((i) => i.url?.trim());
        if (pick?.url) {
          imageDataUrl = await imageUrlToDataUrl(pick.url);
        }
      } catch {
        /* imagen opcional */
      }

      const catalogExtras: FichaPdfParam[] = [];
      const cat = this.productCategoryName(row);
      if (cat && cat !== '—') catalogExtras.push({ parametro: 'Categoría', valor: cat });
      const brand = this.productBrandName(row);
      if (brand && brand !== '—') catalogExtras.push({ parametro: 'Marca', valor: brand });

      await openProductFichaPdf({ product: row, imageDataUrl, catalogExtras });
    } catch (e: unknown) {
      this.errorMessage.set(
        e instanceof Error ? e.message : 'No se pudo generar el PDF de ficha técnica.',
      );
    } finally {
      this.fichaPdfBusyId.set(null);
    }
  }

  filteredSubcategories(): SubcategoryRow[] {
    const catId = this.form.controls.category.value;
    const subId = this.form.controls.subcategory.value;
    const subs = this.subcategories();
    if (catId != null) {
      return subs.filter((s) => Number(s.category) === Number(catId));
    }
    if (subId != null) {
      const match = subs.filter((s) => s.id === Number(subId));
      if (match.length) return match;
    }
    return [];
  }

  /**
   * Si el producto trae subcategoría pero no categoría (o el API anida category dentro de subcategory),
   * rellena categoría para que el `<select>` muestre bien las opciones.
   */
  private syncFormCategorySubcategory(): void {
    if (!this.modalOpen()) return;
    const subId = this.form.controls.subcategory.value;
    if (subId == null) return;
    const catCtrl = this.form.controls.category.value;
    const subs = this.subcategories();
    const sub = subs.find((s) => s.id === Number(subId));
    if (!sub) return;
    if (catCtrl == null || Number(catCtrl) !== Number(sub.category)) {
      this.form.patchValue({ category: sub.category });
    }
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  openNew(): void {
    this.editingId.set(null);
    this.resetSkuCheck();
    this.form.reset({
      id: null,
      sku: '',
      description: '',
      category: null,
      subcategory: null,
      type: null,
      brand: null,
      unit_measurement: null,
      datasheet: '',
      price: null,
      rental_price_without_operator: null,
      rental_price_with_operator: null,
      warranty: '',
      status: 'ACTIVE',
      dimensions: '',
      gross_weight: '',
    });
    this.modalOpen.set(true);
  }

  openEdit(row: Product): void {
    this.editingId.set(row.id);
    this.resetSkuCheck();
    this.modalOpen.set(true);
    this.form.patchValue({
      id: row.id,
      sku: row.sku,
      description: row.description,
      category: this.resolveProductCategoryId(row),
      subcategory: this.coerceFk(row.subcategory),
      type: this.coerceFk(row.type),
      brand: this.coerceFk(row.brand),
      unit_measurement: this.coerceFk(row.unit_measurement),
      datasheet: row.datasheet ?? '',
      price: row.price ?? null,
      rental_price_without_operator: row.rental_price_without_operator ?? null,
      rental_price_with_operator: row.rental_price_with_operator ?? null,
      /** `ProductService` ya normaliza `warranty` incluso si el backend devolvió `warrannty`. */
      warranty: row.warranty ?? '',
      status: row.status || 'ACTIVE',
      dimensions: row.dimensions ?? '',
      gross_weight: row.gross_weight ?? '',
    });
    queueMicrotask(() => {
      this.syncFormCategorySubcategory();
      this.evaluateSkuAvailability(this.form.controls.sku.value);
    });
  }

  private coerceFk(v: number | null): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.resetSkuCheck();
  }

  onCategoryChange(): void {
    const cat = this.form.controls.category.value;
    const sub = this.form.controls.subcategory.value;
    const subs = this.subcategories().filter((s) => Number(s.category) === Number(cat));
    if (sub != null && !subs.some((s) => s.id === sub)) {
      this.form.patchValue({ subcategory: null });
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.evaluateSkuAvailability(this.form.controls.sku.value);
    if (this.skuCheckStatus() === 'exists') {
      this.errorMessage.set('El SKU ya existe. Usa otro código para continuar.');
      return;
    }
    const v = this.form.getRawValue();
    const id = this.editingId();
    const payload: Partial<Product> = this.buildPayload(v);
    this.saving.set(true);
    this.errorMessage.set(null);
    const req =
      id == null
        ? this.api.create(payload)
        : this.api.update(id, payload);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.modalOpen.set(false);
        this.resetSkuCheck();
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  private nullIfBlank(s: string | null | undefined): string | null {
    if (s == null) return null;
    const t = String(s).trim();
    return t === '' ? null : t;
  }

  private nullIfDecimal(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    const t = String(v).trim();
    if (t === '') return null;
    const n = Number(t.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  private buildPayload(v: ReturnType<typeof this.form.getRawValue>): Partial<Product> {
    return {
      sku: v.sku.trim(),
      description: v.description.trim(),
      category: v.category,
      subcategory: v.subcategory,
      type: v.type,
      brand: v.brand,
      unit_measurement: v.unit_measurement,
      datasheet: this.nullIfBlank(v.datasheet),
      price: this.nullIfDecimal(v.price),
      rental_price_without_operator: this.nullIfDecimal(v.rental_price_without_operator),
      rental_price_with_operator: this.nullIfDecimal(v.rental_price_with_operator),
      warranty: this.nullIfBlank(v.warranty),
      status: v.status?.trim() || 'ACTIVE',
      dimensions: this.nullIfBlank(v.dimensions),
      gross_weight: this.nullIfBlank(v.gross_weight),
    };
  }

  downloadProductTemplate(): void {
    downloadProductExcelTemplate();
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
      const buf = await file.arrayBuffer();
      const parsed = parseProductExcel(buf);
      if (!parsed.ok) {
        this.errorMessage.set(parsed.error);
        return;
      }

      const items: Record<string, unknown>[] = [];
      const mapErrors: { sku: string; message: string }[] = [];
      for (const row of parsed.rows) {
        try {
          items.push(excelRowToBulkItem(row));
        } catch (e: unknown) {
          mapErrors.push({
            sku: row.sku || '(sin sku)',
            message: e instanceof Error ? e.message : 'Fila inválida',
          });
        }
      }

      if (!items.length) {
        this.importSummary.set({
          created: 0,
          updated: 0,
          failed: mapErrors.length,
          errors: mapErrors,
        });
        return;
      }

      let created = 0;
      let updated = 0;
      const errors = [...mapErrors];
      const totalChunks = Math.ceil(items.length / BULK_UPSERT_CHUNK_SIZE);

      for (let i = 0; i < items.length; i += BULK_UPSERT_CHUNK_SIZE) {
        const chunkIndex = Math.floor(i / BULK_UPSERT_CHUNK_SIZE);
        this.importProgress.set({ done: chunkIndex + 1, total: totalChunks });
        const chunk = items.slice(i, i + BULK_UPSERT_CHUNK_SIZE);
        try {
          const res = await lastValueFrom(
            this.api.bulkUpsert({
              mode: 'upsert',
              partial_update: true,
              items: chunk,
            }),
          );
          created += Number(res.created) || 0;
          updated += Number(res.updated) || 0;
          for (const e of res.errors ?? []) {
            errors.push({ sku: e.sku || '(sin sku)', message: e.message || 'Error' });
          }
        } catch (e: unknown) {
          this.errorMessage.set(
            `Error en lote ${chunkIndex + 1}/${totalChunks}: ${this.formatError(e)}`,
          );
          errors.push({
            sku: `lote ${chunkIndex + 1}`,
            message: this.formatError(e),
          });
          break;
        }
      }

      this.importSummary.set({
        created,
        updated,
        failed: errors.length,
        errors,
      });
      this.reload();
    } finally {
      this.importBusy.set(false);
      this.importProgress.set(null);
      input.value = '';
    }
  }

  openBulkImage(): void {
    this.bulkFile = null;
    this.bulkFileName.set(null);
    this.bulkImageName.set('');
    this.bulkImagePrimary.set(true);
    this.bulkPickerQuery.set('');
    this.bulkSelectedIds.set(new Set());
    this.bulkProgress.set(null);
    this.bulkSummary.set(null);
    this.bulkImageOpen.set(true);
  }

  closeBulkImage(): void {
    if (this.bulkImageBusy()) return;
    this.bulkImageOpen.set(false);
    this.bulkFile = null;
    this.bulkFileName.set(null);
  }

  onBulkFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.bulkFile = file;
    this.bulkFileName.set(file?.name ?? null);
  }

  isBulkSelected(id: number): boolean {
    return this.bulkSelectedIds().has(id);
  }

  toggleBulkProduct(id: number, checked: boolean): void {
    const next = new Set(this.bulkSelectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.bulkSelectedIds.set(next);
  }

  selectAllBulkVisible(): void {
    const next = new Set(this.bulkSelectedIds());
    for (const p of this.bulkPickerItems()) next.add(p.id);
    this.bulkSelectedIds.set(next);
  }

  clearBulkSelection(): void {
    this.bulkSelectedIds.set(new Set());
  }

  async submitBulkImage(): Promise<void> {
    const file = this.bulkFile;
    const ids = [...this.bulkSelectedIds()];
    if (!file) {
      this.errorMessage.set('Selecciona una imagen para asignar.');
      return;
    }
    if (ids.length === 0) {
      this.errorMessage.set('Selecciona al menos un producto.');
      return;
    }
    this.errorMessage.set(null);
    this.bulkSummary.set(null);
    this.bulkImageBusy.set(true);
    this.bulkProgress.set({ done: 0, total: ids.length });
    const byId = new Map(this.items().map((p) => [p.id, p]));
    const name = this.bulkImageName().trim();
    const primary = this.bulkImagePrimary();
    let ok = 0;
    const errors: { sku: string; message: string }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const product = byId.get(id);
      const sku = product?.sku ?? String(id);
      try {
        await lastValueFrom(
          this.imagesApi.upload(file, id, {
            name: name || undefined,
            primary: primary || undefined,
          }),
        );
        ok++;
      } catch (e: unknown) {
        errors.push({ sku, message: this.formatError(e) });
      }
      this.bulkProgress.set({ done: i + 1, total: ids.length });
    }
    this.bulkSummary.set({ ok, errors });
    this.bulkImageBusy.set(false);
    this.bulkProgress.set(null);
  }

  remove(row: Product): void {
    const ok = window.confirm(
      `¿Eliminar el producto "${row.sku}"?\n\n` +
        `Solo se podrá si no tiene imágenes, stock en almacén ni movimientos asociados (el servidor lo bloquea).`,
    );
    if (!ok) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.formatError(err)),
    });
  }

  private errorBodyAsText(res: HttpErrorResponse): string {
    const e = res.error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      try {
        return JSON.stringify(e);
      } catch {
        return '';
      }
    }
    return '';
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const blob = (this.errorBodyAsText(err) + ' ' + (err.message ?? '')).toLowerCase();
      if (
        blob.includes('protectederror') ||
        blob.includes('protected foreign keys') ||
        blob.includes('cannot delete some instances')
      ) {
        return (
          'No se puede eliminar este producto: el servidor tiene datos vinculados ' +
          '(imágenes del producto, líneas de stock por almacén o movimientos). ' +
          'Elimina antes esas imágenes y registros en Almacén, o deja el producto en estado Inactivo en lugar de borrarlo.'
        );
      }

      const d = err.error;
      if (typeof d === 'string') {
        if (d.includes('<!DOCTYPE') || d.includes('<html') || d.length > 800) {
          return 'Error del servidor. Revisa la consola de red o los logs del backend.';
        }
        return d;
      }
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;

        // Errores de validación de items[] en bulk-upsert
        const itemsErr = (d as { items?: unknown }).items;
        if (Array.isArray(itemsErr)) {
          for (let i = 0; i < itemsErr.length; i++) {
            const row = itemsErr[i];
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            const msgs = Object.entries(row as Record<string, unknown>)
              .map(([k, v]) => {
                const text = Array.isArray(v) ? v.join(', ') : String(v);
                return `${k}: ${text}`;
              })
              .filter(Boolean);
            if (msgs.length) return `Fila ${i + 1} del lote — ${msgs.join('; ')}`;
          }
        }

        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error de red';
    }
    return 'Error desconocido';
  }
}
