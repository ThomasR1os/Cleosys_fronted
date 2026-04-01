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
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly supplierById = computed(() => {
    const m = new Map<number, string>();
    for (const s of this.suppliers()) {
      m.set(s.id, s.name);
    }
    return m;
  });

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    supplier: this.fb.nonNullable.control<number>(0, Validators.required),
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
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  openNew(): void {
    this.editingId.set(null);
    const first = this.suppliers()[0]?.id ?? 0;
    this.form.reset({ id: null, supplier: first, address: '' });
    this.modalOpen.set(true);
  }

  openEdit(row: Warehouse): void {
    this.editingId.set(row.id);
    this.form.patchValue({
      id: row.id,
      supplier: row.supplier,
      address: row.address,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);
    const id = this.editingId();
    const payload = { supplier: v.supplier, address: v.address };
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
        this.errorMessage.set(this.fmt(err));
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
