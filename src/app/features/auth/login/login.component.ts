import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  submit(): void {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { username, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.auth.login(username, password).subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigate(['/inicio']);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const e = err as {
          error?: { detail?: string; non_field_errors?: string[] };
          message?: string;
        };
        const msg =
          e?.error?.detail ??
          e?.error?.non_field_errors?.[0] ??
          e?.message ??
          'No se pudo iniciar sesión. Compruebe usuario y contraseña.';
        this.errorMessage.set(
          typeof msg === 'string' ? msg : 'Error de autenticación.',
        );
      },
    });
  }
}
