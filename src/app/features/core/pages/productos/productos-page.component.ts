import { HttpErrorResponse } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth.service';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import type { Product } from '../../../almacen/models/almacen.models';
import { ProductService } from '../../../almacen/services/product.service';
import {
  downloadProductExcelTemplate,
  excelRowToProductPayload,
  parseProductExcel,
} from './product-excel-import.util';

type CatalogRow = { id: number; name: string };

type SubcategoryRow = CatalogRow & { category: number };

@Component({
  selector: 'app-productos-page',
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe],
  templateUrl: './productos-page.component.html',
})
export class ProductosPageComponent implements OnInit {
  private readonly api = inject(ProductService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<Product[]>([]);
  /** Búsqueda en cliente (SKU, descripción, ID, estado, precio). */
  readonly searchQuery = signal('');
  readonly pageSize = signal(10);
  /** Página 1-based. */
  readonly currentPage = signal(1);

  readonly filteredItems = computed(() => {
    const q = this.searchQuery();
    const all = this.items();
    if (!q.trim()) return all;
    return all.filter((p) => {
      const blob = [
        String(p.id),
        p.sku,
        p.description,
        p.status ?? '',
        p.price ?? '',
        p.datasheet ?? '',
      ].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

  readonly totalFiltered = computed(() => this.filteredItems().length);

  readonly totalPages = computed(() => {
    const n = this.totalFiltered();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(n / size));
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
  readonly importSummary = signal<{
    created: number;
    updated: number;
    errors: { sku: string; message: string }[];
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

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
    warrannty: [''],
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
  }

  ngOnInit(): void {
    this.loadCatalog('categories', this.categories);
    this.loadSubcategories();
    this.loadCatalog('types', this.types);
    this.loadCatalog('brands', this.brands);
    this.loadCatalog('units', this.units);
    this.reload();
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

  /** FK id desde campo plano o objeto anidado `{ id }`. */
  private fkFromRow(row: Record<string, unknown>, key: string): number | null {
    const v = row[key] ?? row[`${key}_id`];
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
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

  statusLabel(status: string): string {
    if (status === 'ACTIVE') return 'Activo';
    if (status === 'INACTIVE') return 'Inactivo';
    return status;
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
      warrannty: '',
      status: 'ACTIVE',
      dimensions: '',
      gross_weight: '',
    });
    this.modalOpen.set(true);
  }

  openEdit(row: Product): void {
    this.editingId.set(row.id);
    this.modalOpen.set(true);
    this.form.patchValue({
      id: row.id,
      sku: row.sku,
      description: row.description,
      category: this.coerceFk(row.category),
      subcategory: this.coerceFk(row.subcategory),
      type: this.coerceFk(row.type),
      brand: this.coerceFk(row.brand),
      unit_measurement: this.coerceFk(row.unit_measurement),
      datasheet: row.datasheet ?? '',
      price: row.price ?? null,
      rental_price_without_operator: row.rental_price_without_operator ?? null,
      rental_price_with_operator: row.rental_price_with_operator ?? null,
      warrannty: row.warrannty ?? '',
      status: row.status || 'ACTIVE',
      dimensions: row.dimensions ?? '',
      gross_weight: row.gross_weight ?? '',
    });
    queueMicrotask(() => this.syncFormCategorySubcategory());
  }

  private coerceFk(v: number | null): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  closeModal(): void {
    this.modalOpen.set(false);
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
      warrannty: this.nullIfBlank(v.warrannty),
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
    this.errorMessage.set(null);
    this.importBusy.set(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseProductExcel(buf);
      if (!parsed.ok) {
        this.errorMessage.set(parsed.error);
        return;
      }
      const bySku = new Map(this.items().map((p) => [p.sku.trim().toLowerCase(), p]));
      let created = 0;
      let updated = 0;
      const errors: { sku: string; message: string }[] = [];
      for (const row of parsed.rows) {
        try {
          const key = row.sku.trim().toLowerCase();
          const existing = bySku.get(key) ?? null;
          const payload = excelRowToProductPayload(row, existing);
          if (existing) {
            await lastValueFrom(this.api.update(existing.id, payload));
            updated++;
          } else {
            const createdProduct = await lastValueFrom(this.api.create(payload));
            bySku.set(key, createdProduct);
            created++;
          }
        } catch (e: unknown) {
          errors.push({ sku: row.sku, message: this.formatError(e) });
        }
      }
      this.importSummary.set({ created, updated, errors });
      this.reload();
    } finally {
      this.importBusy.set(false);
      input.value = '';
    }
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
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error de red';
    }
    return 'Error desconocido';
  }
}
