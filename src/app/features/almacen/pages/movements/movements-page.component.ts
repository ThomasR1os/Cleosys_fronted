import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import type {
  AlmacenProduct,
  MovementType,
  Warehouse,
  WarehouseMovement,
  WarehouseMovementImportError,
  WarehouseMovementWrite,
} from '../../models/almacen.models';
import { AlmacenProductService } from '../../services/almacen-product.service';
import {
  WarehouseMovementService,
  normalizeImportResult,
} from '../../services/warehouse-movement.service';
import { WarehouseService } from '../../services/warehouse.service';
import { downloadMovementExcelTemplate } from './movement-excel.util';

@Component({
  selector: 'app-movements-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './movements-page.component.html',
})
export class MovementsPageComponent implements OnInit {
  private readonly movementsApi = inject(WarehouseMovementService);
  private readonly warehousesApi = inject(WarehouseService);
  private readonly productsApi = inject(AlmacenProductService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly movements = signal<WarehouseMovement[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly products = signal<AlmacenProduct[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalError = signal<string | null>(null);
  readonly importBusy = signal(false);
  readonly importSummary = signal<string | null>(null);
  readonly importErrors = signal<WarehouseMovementImportError[]>([]);
  readonly modalOpen = signal(false);
  readonly productQuery = signal('');
  readonly productMenuOpen = signal(false);
  readonly searchQuery = signal('');
  readonly typeFilter = signal<'ALL' | MovementType>('ALL');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly warehouseLabel = computed(() => {
    const m = new Map<number, string>();
    for (const w of this.warehouses()) {
      m.set(w.id, `#${w.id} — ${w.address}`);
    }
    return m;
  });

  readonly productLabel = computed(() => {
    const m = new Map<number, string>();
    for (const p of this.products()) {
      m.set(p.id, `${p.sku} — ${p.description}`);
    }
    return m;
  });

  readonly typeOptions: { value: MovementType; label: string }[] = [
    { value: 'ENTRADA', label: 'Entrada' },
    { value: 'SALIDA', label: 'Salida' },
  ];

  readonly filteredMovements = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const type = this.typeFilter();
    const warehouses = this.warehouseLabel();
    const products = this.productLabel();
    return this.movements().filter((row) => {
      if (type !== 'ALL' && row.movement_type !== type) return false;
      if (!q) return true;
      const blob = [
        String(row.id),
        warehouses.get(row.warehouse) ?? '',
        products.get(row.product) ?? '',
        String(row.cant),
        row.movement_type,
        this.tipoLabel(row.movement_type),
        row.observation ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  });

  readonly totalLoaded = computed(() => this.movements().length);
  readonly totalCount = computed(() => this.filteredMovements().length);
  readonly totalPages = computed(() => {
    const count = this.totalCount();
    if (count === 0) return 0;
    return Math.ceil(count / this.pageSize());
  });
  readonly pagedMovements = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredMovements().slice(start, start + this.pageSize());
  });
  readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() =>
    Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()),
  );
  readonly hasActiveFilters = computed(
    () => this.searchQuery().trim().length > 0 || this.typeFilter() !== 'ALL',
  );

  readonly productMatches = computed(() => {
    const query = this.productQuery().trim();
    const rows = this.products();
    if (!query) return rows.slice(0, 12);
    return rows
      .filter((product) => textMatchesLooseQuery(`${product.sku} ${product.description}`, query))
      .slice(0, 20);
  });

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    warehouse: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    product: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    cant: this.fb.nonNullable.control<number>(1, [Validators.required, Validators.min(0.0001)]),
    movement_type: this.fb.nonNullable.control<MovementType>('ENTRADA', Validators.required),
    observation: this.fb.nonNullable.control('', Validators.maxLength(500)),
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      mov: this.movementsApi.list(),
      wh: this.warehousesApi.list(),
      pr: this.productsApi.list(),
    }).subscribe({
      next: ({ mov, wh, pr }) => {
        this.movements.set([...mov].sort((a, b) => b.id - a.id));
        this.warehouses.set(wh);
        this.products.set(pr);
        this.loading.set(false);
        this.clampPage();
        if (wh.length && this.form.controls.warehouse.value === 0 && !this.modalOpen()) {
          this.form.patchValue({ warehouse: wh[0].id });
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  setTypeFilter(value: string): void {
    if (value === 'ENTRADA' || value === 'SALIDA' || value === 'ALL') {
      this.typeFilter.set(value);
      this.pageIndex.set(0);
    }
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.typeFilter.set('ALL');
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

  openNew(): void {
    this.modalError.set(null);
    const wh = this.warehouses()[0]?.id ?? 0;
    this.productQuery.set('');
    this.productMenuOpen.set(false);
    this.form.reset({
      id: null,
      warehouse: wh,
      product: 0,
      cant: 1,
      movement_type: 'ENTRADA',
      observation: '',
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.productMenuOpen.set(false);
    this.modalOpen.set(false);
  }

  onProductQuery(value: string): void {
    this.productQuery.set(value);
    this.productMenuOpen.set(true);
    const selected = this.products().find((product) => product.id === this.form.controls.product.value);
    const label = selected ? this.productChoiceLabel(selected) : '';
    if (label && value.trim() !== label) {
      this.form.controls.product.setValue(0);
      this.form.controls.product.markAsDirty();
    }
  }

  openProductMenu(): void {
    this.productMenuOpen.set(true);
  }

  closeProductMenuSoon(): void {
    window.setTimeout(() => {
      this.productMenuOpen.set(false);
      this.form.controls.product.markAsTouched();
    }, 180);
  }

  pickProduct(product: AlmacenProduct, event?: Event): void {
    event?.preventDefault();
    this.productQuery.set(this.productChoiceLabel(product));
    this.productMenuOpen.set(false);
    this.form.controls.product.setValue(product.id);
    this.form.controls.product.markAsDirty();
  }

  setMovementType(type: MovementType): void {
    this.form.controls.movement_type.setValue(type);
    this.form.controls.movement_type.markAsDirty();
  }

  isFieldInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && c.touched;
  }

  fieldError(name: string): string | null {
    const c = this.form.get(name);
    if (!c || !c.invalid || !c.touched) return null;
    if (c.errors?.['maxlength']) return 'Máximo 500 caracteres.';
    if (name === 'product' && (c.errors?.['required'] || c.errors?.['min'])) {
      return 'Elige un producto de la lista.';
    }
    if (c.errors?.['required'] || c.errors?.['min']) {
      return name === 'cant' ? 'Indique una cantidad mayor que cero.' : 'Este campo es obligatorio.';
    }
    return 'Valor no válido.';
  }

  showModalValidationHint(): boolean {
    return this.form.invalid && this.form.touched;
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.modalError.set(null);
    const note = v.observation.trim();
    const body: WarehouseMovementWrite = {
      warehouse: v.warehouse,
      product: v.product,
      cant: formatCant(v.cant),
      movement_type: v.movement_type,
    };
    if (note) {
      body.observation = note;
    }
    this.movementsApi.create(body).subscribe({
      next: () => {
        this.saving.set(false);
        this.modalOpen.set(false);
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.modalError.set(this.fmt(err));
      },
    });
  }

  downloadTemplate(): void {
    downloadMovementExcelTemplate();
  }

  onExcelSelected(ev: Event): void {
    if (!this.auth.canWriteAlmacen()) return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.importSummary.set(null);
    this.importErrors.set([]);
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.errorMessage.set('El archivo debe ser Excel .xlsx.');
      return;
    }
    this.importBusy.set(true);
    this.errorMessage.set(null);
    this.movementsApi.importExcel(file).subscribe({
      next: (res) => {
        this.importBusy.set(false);
        this.applyImportResult(res);
      },
      error: (err) => {
        this.importBusy.set(false);
        const parsed = importResultFromError(err);
        if (parsed) {
          this.applyImportResult(parsed);
          return;
        }
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  remove(row: WarehouseMovement): void {
    if (!window.confirm(`¿Eliminar el movimiento #${row.id}? Se revertirá el efecto en stock.`)) {
      return;
    }
    this.errorMessage.set(null);
    this.movementsApi.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  tipoLabel(t: MovementType): string {
    return t === 'ENTRADA' ? 'Entrada' : 'Salida';
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es');
  }

  private productChoiceLabel(product: AlmacenProduct): string {
    return `${product.sku} — ${product.description}`;
  }

  private applyImportResult(res: { created: number; failed: number; errors: WarehouseMovementImportError[] }): void {
    if (res.created > 0) {
      this.importErrors.set([]);
      this.importSummary.set(
        res.created === 1
          ? 'Se registró 1 movimiento. El stock ya está actualizado.'
          : `Se registraron ${res.created} movimientos. El stock ya está actualizado.`,
      );
      this.reload();
      return;
    }
    this.importSummary.set(null);
    this.importErrors.set(res.errors);
    if (res.errors.length === 0) {
      this.errorMessage.set('No se registró ningún movimiento. El stock no cambió.');
    }
  }

  private clampPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex() > last) this.pageIndex.set(last);
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}

function formatCant(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  const fixed = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (!fixed.includes('.')) return `${fixed}.00`;
  const decimals = fixed.split('.')[1] ?? '';
  if (decimals.length < 2) return `${fixed}${'0'.repeat(2 - decimals.length)}`;
  return fixed;
}

function importResultFromError(err: unknown): ReturnType<typeof normalizeImportResult> | null {
  if (!(err instanceof HttpErrorResponse) || !err.error || typeof err.error !== 'object') return null;
  const body = err.error as Record<string, unknown>;
  if (!Array.isArray(body['errors'])) return null;
  return normalizeImportResult(body);
}
