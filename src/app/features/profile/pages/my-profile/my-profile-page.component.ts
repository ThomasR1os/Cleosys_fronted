import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import type { AdminUserUpdateRequest } from '../../../admin/models/admin-users.models';
import { AdminUserService } from '../../../admin/services/admin-user.service';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const p = group.get('new_password')?.value as string | undefined;
  const c = group.get('confirm_password')?.value as string | undefined;
  const pw = (p ?? '').trim();
  if (!pw) return null;
  return pw === (c ?? '').trim() ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-my-profile-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './my-profile-page.component.html',
})
export class MyProfilePageComponent implements OnInit {
  private readonly api = inject(AdminUserService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.email]],
      first_name: [''],
      last_name: [''],
      cellphone: [''],
      quotation_prefix: ['', [Validators.maxLength(10)]],
      new_password: [''],
      confirm_password: [''],
    },
    { validators: [passwordsMatch] },
  );

  ngOnInit(): void {
    const m = this.auth.me();
    if (!m?.user) {
      this.auth.loadProfile().subscribe({
        next: () => this.patchFromSession(),
        error: () => {
          this.errorMessage.set('No se pudo cargar su sesión.');
        },
      });
    } else {
      this.patchFromSession();
    }
  }

  private patchFromSession(): void {
    const m = this.auth.me();
    const u = m?.user;
    if (!u) return;
    this.form.patchValue({
      email: u.email ?? '',
      first_name: u.first_name ?? '',
      last_name: u.last_name ?? '',
      cellphone: u.cellphone ?? '',
      quotation_prefix: m.profile?.quotation_prefix ?? '',
    });
  }

  save(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const id = this.auth.me()?.user?.id;
    if (id == null) {
      this.errorMessage.set('Sesión no válida.');
      return;
    }
    const raw = this.form.getRawValue();
    const patch: AdminUserUpdateRequest = {
      email: raw.email.trim() || undefined,
      first_name: raw.first_name.trim() || undefined,
      last_name: raw.last_name.trim() || undefined,
      cellphone: raw.cellphone.trim() || undefined,
    };
    if (this.auth.me()?.profile) {
      patch.quotation_prefix = raw.quotation_prefix.trim() || undefined;
    }
    const pwd = raw.new_password.trim();
    this.saving.set(true);
    this.api
      .update(id, patch)
      .pipe(
        switchMap(() =>
          pwd ? this.api.setPassword(id, { password: pwd }) : of(undefined),
        ),
        switchMap(() => this.auth.loadProfile()),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.successMessage.set('Cambios guardados.');
          this.form.patchValue({
            new_password: '',
            confirm_password: '',
          });
          this.patchFromSession();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.errorMessage.set(this.fmt(err));
        },
      });
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
