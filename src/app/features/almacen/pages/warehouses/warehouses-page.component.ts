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
import { SupplierService } from '../../../core/services/supplier.service';
import type { Supplier } from '../../../core/models/supplier.model';
import type { Warehouse } from '../../models/almacen.models';
import { WarehouseService } from '../../services/warehouse.service';

@Component({
  selector: 'app-warehouses-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './warehouses-page.component.html',
})
export class WarehousesPageComponent implements OnInit {
  private readonly warehousesApi = inject(WarehouseService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<Warehouse[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalError = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly searchQuery = signal('');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly supplierById = computed(() => {
    const m = new Map<number, string>();
    for (const s of this.suppliers()) {
      m.set(s.id, s.name);
    }
    return m;
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const names = this.supplierById();
    const rows = this.items();
    if (!q) return rows;
    return rows.filter((row) => {
      const supplier = (names.get(row.supplier) ?? String(row.supplier)).toLowerCase();
      return (
        String(row.id).includes(q) ||
        row.address.toLowerCase().includes(q) ||
        supplier.includes(q)
      );
    });
  });

  readonly totalLoaded = computed(() => this.items().length);
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
  readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() =>
    Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()),
  );
  readonly hasActiveSearch = computed(() => this.searchQuery().trim().length > 0);

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    supplier: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    address: ['', Validators.required],
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      wh: this.warehousesApi.list(),
      sup: this.suppliersApi.list(),
    }).subscribe({
      next: ({ wh, sup }) => {
        this.items.set(wh);
        this.suppliers.set(sup);
        this.loading.set(false);
        this.clampPage();
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

  clearSearch(): void {
    this.searchQuery.set('');
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
    this.editingId.set(null);
    const first = this.suppliers()[0]?.id ?? 0;
    this.form.reset({ id: null, supplier: first, address: '' });
    this.modalOpen.set(true);
  }

  openEdit(row: Warehouse): void {
    this.modalError.set(null);
    this.editingId.set(row.id);
    this.form.reset({
      id: row.id,
      supplier: row.supplier,
      address: row.address,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  isFieldInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && c.touched;
  }

  fieldError(name: string): string | null {
    const c = this.form.get(name);
    if (!c || !c.invalid || !c.touched) return null;
    if (c.errors?.['required'] || c.errors?.['min']) return 'Este campo es obligatorio.';
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
    const id = this.editingId();
    const payload = { supplier: v.supplier, address: v.address.trim() };
    const req =
      id == null
        ? this.warehousesApi.create({
            ...payload,
            ...(v.id != null ? { id: v.id } : {}),
          })
        : this.warehousesApi.update(id, payload);
    req.subscribe({
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

  remove(row: Warehouse): void {
    if (!window.confirm(`¿Eliminar el almacén #${row.id}?`)) return;
    this.errorMessage.set(null);
    this.warehousesApi.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
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
