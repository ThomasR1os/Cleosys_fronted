import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupplierService } from '../../services/supplier.service';
import type { Supplier, SupplierType } from '../../models/supplier.model';

@Component({
  selector: 'app-suppliers-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './suppliers-page.component.html',
})
export class SuppliersPageComponent implements OnInit {
  private readonly api = inject(SupplierService);
  private readonly fb = inject(FormBuilder);

  readonly items = signal<Supplier[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly totalCount = computed(() => this.items().length);
  readonly totalPages = computed(() => {
    const count = this.totalCount();
    if (count === 0) return 0;
    return Math.ceil(count / this.pageSize());
  });
  readonly pagedItems = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.items().slice(start, start + this.pageSize());
  });
  readonly rangeStart = computed(() => (this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1));
  readonly rangeEnd = computed(() => Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()));

  readonly typeOptions: { value: SupplierType; label: string }[] = [
    { value: 'NACIONAL', label: 'Nacional' },
    { value: 'EXTRANJERO', label: 'Extranjero' },
  ];

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    type: this.fb.nonNullable.control<SupplierType>('NACIONAL', Validators.required),
    ruc: ['', Validators.required],
    name: ['', Validators.required],
    address: ['', Validators.required],
    contact: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    bank_accounts: ['', Validators.required],
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
        this.clampPage();
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
      type: 'NACIONAL',
      ruc: '',
      name: '',
      address: '',
      contact: '',
      email: '',
      phone: '',
      bank_accounts: '',
    });
    this.modalOpen.set(true);
  }

  openEdit(row: Supplier): void {
    this.editingId.set(row.id);
    this.form.patchValue({
      id: row.id,
      type: row.type,
      ruc: row.ruc,
      name: row.name,
      address: row.address,
      contact: row.contact,
      email: row.email,
      phone: row.phone,
      bank_accounts: row.bank_accounts,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
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

  /** Muestra error bajo el campo tras intentar guardar o al tocar el control. */
  isFieldInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && c.touched;
  }

  fieldError(name: string): string | null {
    const c = this.form.get(name);
    if (!c || !c.invalid || !c.touched) return null;
    const e = c.errors;
    if (!e) return null;
    if (e['required']) return 'Este campo es obligatorio.';
    if (e['email']) return 'Introduzca un correo electrónico válido.';
    return 'Valor no válido.';
  }

  /** Resumen en el modal cuando faltan datos obligatorios (p. ej. cuentas bancarias). */
  showModalValidationHint(): boolean {
    return this.form.invalid && this.form.touched;
  }

  save(): void {
    const current = this.form.getRawValue();
    this.form.patchValue({
      ruc: this.toUpper(current.ruc),
      name: this.toUpper(current.name),
      address: this.toUpper(current.address),
      contact: this.toUpper(current.contact),
      email: this.toUpper(current.email),
      phone: this.toUpper(current.phone),
      bank_accounts: this.toUpper(current.bank_accounts),
    });
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);
    const id = this.editingId();
    const payload = {
      type: v.type,
      ruc: this.toUpper(v.ruc),
      name: this.toUpper(v.name),
      address: this.toUpper(v.address),
      contact: this.toUpper(v.contact),
      email: this.toUpper(v.email),
      phone: this.toUpper(v.phone),
      bank_accounts: this.toUpper(v.bank_accounts),
    };
    const req =
      id == null
        ? this.api.create({
            ...payload,
            ...(v.id != null ? { id: v.id } : {}),
          })
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

  remove(row: Supplier): void {
    const ok = window.confirm(
      `¿Eliminar el proveedor "${row.name}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.formatError(err)),
    });
  }

  private toUpper(value: string | null | undefined): string {
    return String(value ?? '').toLocaleUpperCase('es-PE');
  }

  private clampPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex() > last) this.pageIndex.set(last);
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
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
