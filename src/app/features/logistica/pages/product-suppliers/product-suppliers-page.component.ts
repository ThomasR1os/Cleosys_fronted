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
import type { AlmacenProduct } from '../../../almacen/models/almacen.models';
import { AlmacenProductService } from '../../../almacen/services/almacen-product.service';
import type { ProductSupplierMoney, ProductSupplierRow } from '../../models/logistica.models';
import { ProductSupplierService } from '../../services/product-supplier.service';

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
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly filterProductId = signal<number | null>(null);
  readonly filterSupplierId = signal<number | null>(null);

  readonly filteredItems = computed(() => {
    let rows = this.items();
    const fp = this.filterProductId();
    const fs = this.filterSupplierId();
    if (fp != null) rows = rows.filter((r) => r.product === fp);
    if (fs != null) rows = rows.filter((r) => r.supplier === fs);
    return rows;
  });

  readonly productLabel = computed(() => {
    const m = new Map<number, string>();
    for (const p of this.products()) {
      m.set(p.id, `${p.sku} — ${p.description}`);
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
    product: this.fb.nonNullable.control<number>(0, Validators.required),
    supplier: this.fb.nonNullable.control<number>(0, Validators.required),
    money: this.fb.nonNullable.control<ProductSupplierMoney>('PEN', Validators.required),
    cost: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(0)]),
    incoterm: ['', [Validators.required, Validators.maxLength(3)]],
  });

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
        this.products.set(pr);
        this.suppliers.set(sup);
        if (pr.length && this.form.controls.product.value === 0) {
          this.form.patchValue({ product: pr[0].id });
        }
        if (sup.length && this.form.controls.supplier.value === 0) {
          this.form.patchValue({ supplier: sup[0].id });
        }
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
    const pr = this.products()[0]?.id ?? 0;
    const sup = this.suppliers()[0]?.id ?? 0;
    this.form.reset({
      id: null,
      product: pr,
      supplier: sup,
      money: 'PEN',
      cost: 0,
      incoterm: '',
    });
    this.modalOpen.set(true);
  }

  openEdit(row: ProductSupplierRow): void {
    this.editingId.set(row.id);
    this.form.patchValue({
      id: row.id,
      product: row.product,
      supplier: row.supplier,
      money: row.money,
      cost: Number(row.cost),
      incoterm: row.incoterm,
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
    const payload: Record<string, unknown> = {
      product: v.product,
      supplier: v.supplier,
      money: v.money,
      cost: v.cost,
      incoterm: v.incoterm.toUpperCase().slice(0, 3),
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

  remove(row: ProductSupplierRow): void {
    if (!window.confirm(`¿Eliminar la relación #${row.id}?`)) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
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
