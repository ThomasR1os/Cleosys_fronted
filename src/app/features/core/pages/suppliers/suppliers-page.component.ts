import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
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

  readonly typeOptions: { value: SupplierType; label: string }[] = [
    { value: 'NACIONAL', label: 'Nacional' },
    { value: 'EXTRANJERO', label: 'Extranjero' },
  ];

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    type: this.fb.nonNullable.control<SupplierType>('NACIONAL', Validators.required),
    ruc: ['', Validators.required],
    name: ['', Validators.required],
    adress: ['', Validators.required],
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
      adress: '',
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
      adress: row.adress,
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
      ruc: v.ruc,
      name: v.name,
      adress: v.adress,
      contact: v.contact,
      email: v.email,
      phone: v.phone,
      bank_accounts: v.bank_accounts,
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
