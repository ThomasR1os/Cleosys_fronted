import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import type { ClientRow } from '../../models/ventas.models';
import { ClientService } from '../../services/client.service';

@Component({
  selector: 'app-clients-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './clients-page.component.html',
})
export class ClientsPageComponent implements OnInit {
  private readonly api = inject(ClientService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<ClientRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  /** Edición de ficha de cliente: admin o rol ventas (el servidor puede restringir el listado). */
  readonly canEditClients = computed(() => {
    if (this.auth.isAdmin()) return true;
    return this.auth.me()?.profile?.role === 'VENTAS';
  });

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    ruc: ['', Validators.required],
    name: ['', Validators.required],
    contact_first_name: [''],
    contact_last_name: [''],
    email: [''],
    phone: [''],
  });

  ngOnInit(): void {
    this.reload();
  }

  canEdit(_client: ClientRow): boolean {
    return this.canEditClients();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.items.set([...rows].sort((a, b) => b.id - a.id));
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
    this.form.reset({
      id: null,
      ruc: '',
      name: '',
      contact_first_name: '',
      contact_last_name: '',
      email: '',
      phone: '',
    });
    this.modalOpen.set(true);
  }

  openEdit(row: ClientRow): void {
    if (!this.canEdit(row)) return;
    this.editingId.set(row.id);
    this.form.patchValue({
      id: row.id,
      ruc: row.ruc,
      name: row.name,
      contact_first_name: '',
      contact_last_name: '',
      email: '',
      phone: '',
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  save(): void {
    const id = this.editingId();
    if (id == null) {
      this.form.controls.contact_first_name.setValidators([Validators.required]);
      this.form.controls.contact_last_name.setValidators([Validators.required]);
    } else {
      this.form.controls.contact_first_name.clearValidators();
      this.form.controls.contact_last_name.clearValidators();
    }
    this.form.controls.contact_first_name.updateValueAndValidity();
    this.form.controls.contact_last_name.updateValueAndValidity();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);

    if (id == null) {
      const payload: Parameters<ClientService['create']>[0] = {
        ruc: v.ruc,
        name: v.name,
        contact: {
          contact_first_name: v.contact_first_name.trim(),
          contact_last_name: v.contact_last_name.trim(),
          ...(v.email.trim() ? { email: v.email.trim() } : {}),
          ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
        },
      };
      if (v.id != null) payload.id = v.id;

      this.api.create(payload).subscribe({
        next: () => this.afterSaveOk(),
        error: (err) => this.onSaveErr(err),
      });
    } else {
      this.api
        .update(id, {
          ruc: v.ruc,
          name: v.name,
        })
        .subscribe({
          next: () => this.afterSaveOk(),
          error: (err) => this.onSaveErr(err),
        });
    }
  }

  private afterSaveOk(): void {
    this.saving.set(false);
    this.modalOpen.set(false);
    this.reload();
  }

  private onSaveErr(err: unknown): void {
    this.saving.set(false);
    this.errorMessage.set(this.fmt(err));
  }

  remove(row: ClientRow): void {
    if (!this.canEdit(row)) return;
    if (!window.confirm(`¿Eliminar el cliente «${row.name}»?`)) return;
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
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;
        const parts: string[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (k === 'detail') continue;
          if (typeof v === 'string') parts.push(`${k}: ${v}`);
          else if (Array.isArray(v) && typeof v[0] === 'string') parts.push(`${k}: ${v[0]}`);
          else if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
              if (Array.isArray(v2) && typeof v2[0] === 'string') parts.push(`${k}.${k2}: ${v2[0]}`);
              else if (typeof v2 === 'string') parts.push(`${k}.${k2}: ${v2}`);
            }
          }
        }
        if (parts.length) return parts.join(' · ');
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
