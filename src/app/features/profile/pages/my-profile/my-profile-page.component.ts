import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnDestroy,
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
export class MyProfilePageComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminUserService);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly saving = signal(false);
  readonly signatureBusy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  /** Vista previa local al elegir archivo (antes de subir). */
  readonly signaturePreviewUrl = signal<string | null>(null);
  private pendingSignatureFile: File | null = null;

  readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.email]],
      first_name: [''],
      last_name: [''],
      cellphone: [''],
      quotation_prefix: ['', [Validators.maxLength(10)]],
      reply_to_email: ['', [Validators.email]],
      email_display_name: [''],
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

  ngOnDestroy(): void {
    this.revokeSignaturePreview();
  }

  /** Firma guardada en el perfil o preview local. */
  signatureDisplaySrc(): string | null {
    return this.signaturePreviewUrl() || this.auth.me()?.profile?.signature_url || null;
  }

  onSignatureFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.revokeSignaturePreview();
    this.pendingSignatureFile = null;
    this.signaturePreviewUrl.set(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.errorMessage.set('La firma debe ser una imagen (PNG, JPG, etc.).');
      return;
    }
    this.pendingSignatureFile = file;
    this.signaturePreviewUrl.set(URL.createObjectURL(file));
  }

  uploadSignature(): void {
    const file = this.pendingSignatureFile;
    if (!file) {
      this.errorMessage.set('Selecciona una imagen de firma.');
      return;
    }
    this.signatureBusy.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.auth.uploadSignature(file).subscribe({
      next: () => {
        this.signatureBusy.set(false);
        this.clearPendingSignature();
        this.successMessage.set('Firma actualizada.');
      },
      error: (err: unknown) => {
        this.signatureBusy.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  removeSignature(): void {
    if (!this.auth.me()?.profile?.signature_url && !this.pendingSignatureFile) return;
    if (this.pendingSignatureFile && !this.auth.me()?.profile?.signature_url) {
      this.clearPendingSignature();
      return;
    }
    if (!window.confirm('¿Eliminar tu firma del perfil?')) return;
    this.signatureBusy.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.auth.deleteSignature().subscribe({
      next: () => {
        this.signatureBusy.set(false);
        this.clearPendingSignature();
        this.successMessage.set('Firma eliminada.');
      },
      error: (err: unknown) => {
        this.signatureBusy.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  clearPendingSignature(): void {
    this.revokeSignaturePreview();
    this.pendingSignatureFile = null;
    this.signaturePreviewUrl.set(null);
  }

  private revokeSignaturePreview(): void {
    const u = this.signaturePreviewUrl();
    if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
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
      reply_to_email: m.profile?.reply_to_email ?? '',
      email_display_name: m.profile?.email_display_name ?? '',
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
    const replyTo = raw.reply_to_email.trim();
    const displayName = raw.email_display_name.trim();
    this.saving.set(true);
    this.api
      .update(id, patch)
      .pipe(
        switchMap(() =>
          pwd ? this.api.setPassword(id, { password: pwd }) : of(undefined),
        ),
        switchMap(() =>
          this.auth.me()?.profile
            ? this.auth.patchMe({
                profile: {
                  reply_to_email: replyTo || null,
                  email_display_name: displayName || null,
                },
              })
            : of(null),
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
