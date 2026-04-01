import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import type {
  AdminUser,
  AdminUserCreateRequest,
  AdminUserUpdateRequest,
  CompanyOption,
  UserRole,
} from '../../models/admin-users.models';
import { AdminUserService } from '../../services/admin-user.service';

@Component({
  selector: 'app-users-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './users-page.component.html',
})
export class UsersPageComponent implements OnInit {
  private readonly api = inject(AdminUserService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<AdminUser[]>([]);
  readonly companies = signal<CompanyOption[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly roleOpts: { value: UserRole; label: string }[] = [
    { value: 'ADMIN', label: 'Administrador' },
    { value: 'ALMACEN', label: 'Almacén' },
    { value: 'LOGISTICA', label: 'Logística' },
    { value: 'VENTAS', label: 'Ventas' },
  ];

  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: [''],
    email: [''],
    first_name: [''],
    last_name: [''],
    cellphone: [''],
    is_active: this.fb.nonNullable.control(true),
    role: this.fb.nonNullable.control<UserRole>('VENTAS', Validators.required),
    company_id: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    quotation_prefix: ['', [Validators.maxLength(10)]],
  });

  ngOnInit(): void {
    const c = this.auth.me()?.profile?.company;
    const fallback: CompanyOption[] = c ? [{ id: c.id, name: c.name }] : [];
    this.api
      .listCompanies()
      .pipe(catchError(() => of([] as CompanyOption[])))
      .subscribe((rows) => {
        this.companies.set(rows.length ? rows : fallback);
        const first = this.companies()[0]?.id;
        if (first != null && this.form.controls.company_id.value === 0) {
          this.form.patchValue({ company_id: first });
        }
      });
    this.reload();
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
    const firstCo = this.companies()[0]?.id ?? this.auth.me()?.profile?.company?.id ?? 0;
    const prefix = this.auth.me()?.profile?.quotation_prefix ?? '';
    this.form.reset({
      username: '',
      password: '',
      email: '',
      first_name: '',
      last_name: '',
      cellphone: '',
      is_active: true,
      role: 'VENTAS',
      company_id: firstCo,
      quotation_prefix: prefix,
    });
    this.form.get('password')?.setValidators([Validators.required]);
    this.form.get('password')?.updateValueAndValidity();
    this.form.get('username')?.enable();
    this.modalOpen.set(true);
  }

  openEdit(row: AdminUser): void {
    this.editingId.set(row.id);
    let co = row.profile?.company.id ?? this.auth.me()?.profile?.company?.id ?? 0;
    if (co < 1) co = this.companies()[0]?.id ?? 1;
    this.form.patchValue({
      username: row.username,
      password: '',
      email: row.email ?? '',
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      cellphone: row.cellphone ?? '',
      is_active: row.is_active,
      role: (row.profile?.role ?? 'VENTAS') as UserRole,
      company_id: co,
      quotation_prefix: row.profile?.quotation_prefix ?? '',
    });
    this.form.get('password')?.clearValidators();
    this.form.get('password')?.updateValueAndValidity();
    this.form.get('username')?.disable();
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
    const id = this.editingId();
    const raw = this.form.getRawValue();
    const companyId = Number(raw.company_id);
    if (!Number.isFinite(companyId) || companyId < 1) {
      this.form.get('company_id')?.setErrors({ invalid: true });
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);

    const prefix = raw.quotation_prefix.trim();

    if (id == null) {
      const body: AdminUserCreateRequest = {
        username: raw.username,
        password: raw.password,
        email: raw.email.trim() || undefined,
        first_name: raw.first_name.trim() || undefined,
        last_name: raw.last_name.trim() || undefined,
        cellphone: raw.cellphone.trim() || undefined,
        is_active: raw.is_active,
        company_id: companyId,
        role: raw.role,
        quotation_prefix: prefix || undefined,
      };
      this.api.create(body).subscribe({
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
      return;
    }

    const patch: AdminUserUpdateRequest = {
      email: raw.email.trim() || undefined,
      first_name: raw.first_name.trim() || undefined,
      last_name: raw.last_name.trim() || undefined,
      cellphone: raw.cellphone.trim() || undefined,
      is_active: raw.is_active,
      company_id: companyId,
      role: raw.role,
      quotation_prefix: prefix || undefined,
    };

    const pwd = raw.password.trim();
    this.api
      .update(id, patch)
      .pipe(
        switchMap(() =>
          pwd ? this.api.setPassword(id, { password: pwd }) : of(undefined),
        ),
      )
      .subscribe({
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

  remove(row: AdminUser): void {
    const label = this.displayName(row);
    if (!window.confirm(`¿Eliminar al usuario «${label}»?`)) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  displayName(row: AdminUser): string {
    const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return full || row.username;
  }

  roleLabel(role: string | undefined): string {
    return this.roleOpts.find((o) => o.value === role)?.label ?? role ?? '—';
  }

  companyLabel(row: AdminUser): string {
    return row.profile?.company.name ?? '—';
  }

  prefixLabel(row: AdminUser): string {
    const p = row.profile?.quotation_prefix?.trim();
    return p || '—';
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
