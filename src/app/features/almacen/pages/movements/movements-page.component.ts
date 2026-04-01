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
import type { AlmacenProduct, MovementType, Warehouse, WarehouseMovement } from '../../models/almacen.models';
import { AlmacenProductService } from '../../services/almacen-product.service';
import { WarehouseMovementService } from '../../services/warehouse-movement.service';
import { WarehouseService } from '../../services/warehouse.service';

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
  readonly modalOpen = signal(false);

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

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    warehouse: this.fb.nonNullable.control<number>(0, Validators.required),
    product: this.fb.nonNullable.control<number>(0, Validators.required),
    cant: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(0.0001)]),
    movement_type: this.fb.nonNullable.control<MovementType>('ENTRADA', Validators.required),
    observation: this.fb.nonNullable.control<number>(0, Validators.required),
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
        if (wh.length && this.form.controls.warehouse.value === 0) {
          this.form.patchValue({ warehouse: wh[0].id });
        }
        if (pr.length && this.form.controls.product.value === 0) {
          this.form.patchValue({ product: pr[0].id });
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  openNew(): void {
    const wh = this.warehouses()[0]?.id ?? 0;
    const pr = this.products()[0]?.id ?? 0;
    this.form.reset({
      id: null,
      warehouse: wh,
      product: pr,
      cant: 1,
      movement_type: 'ENTRADA',
      observation: 0,
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
    const body: Record<string, unknown> = {
      warehouse: v.warehouse,
      product: v.product,
      cant: v.cant,
      movement_type: v.movement_type,
      observation: v.observation,
    };
    if (v.id != null) {
      body['id'] = v.id;
    }
    this.movementsApi.create(body as Partial<WarehouseMovement>).subscribe({
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
