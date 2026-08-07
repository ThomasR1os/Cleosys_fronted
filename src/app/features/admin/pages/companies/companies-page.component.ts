import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import type { Company, CompanyBranding } from '../../models/admin-users.models';
import { CompanyService } from '../../services/company.service';
import {
  COMPANY_BRANDING_FIELD_META,
  DEFAULT_COMPANY_BRANDING,
} from '../../utils/company-branding.utils';

@Component({
  selector: 'app-companies-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './companies-page.component.html',
})
export class CompaniesPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(CompanyService);
  private readonly fb = inject(FormBuilder);

  readonly items = signal<Company[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  /** Fila en edición (para vista previa del logo existente). */
  readonly editingRow = signal<Company | null>(null);

  /** Archivo elegido en el modal (sustituye el logo anterior al guardar). */
  readonly logoFile = signal<File | null>(null);
  /** Vista previa local o null si no hay selección. */
  readonly logoPreviewUrl = signal<string | null>(null);

  /** Meta para pintar controles de color con etiquetas (documentos PDF). */
  readonly brandingFields = COMPANY_BRANDING_FIELD_META;

  readonly emailSettingsLoading = signal(false);
  readonly emailSettingsSaving = signal(false);
  readonly emailTestBusy = signal(false);
  readonly emailSettingsMessage = signal<string | null>(null);
  readonly emailSettingsError = signal<string | null>(null);
  readonly emailPasswordConfigured = signal(false);

  readonly form = this.fb.nonNullable.group({
    ruc: [''],
    name: ['', Validators.required],
    bank_accounts: [''],
  });

  readonly brandingForm = this.fb.nonNullable.group({
    primary: [DEFAULT_COMPANY_BRANDING.primary, Validators.required],
    primary_light: [DEFAULT_COMPANY_BRANDING.primary_light, Validators.required],
    muted: [DEFAULT_COMPANY_BRANDING.muted, Validators.required],
    border: [DEFAULT_COMPANY_BRANDING.border, Validators.required],
    table_stripe: [DEFAULT_COMPANY_BRANDING.table_stripe, Validators.required],
    emphasis_bar: [DEFAULT_COMPANY_BRANDING.emphasis_bar, Validators.required],
    text_body: [DEFAULT_COMPANY_BRANDING.text_body, Validators.required],
    text_label: [DEFAULT_COMPANY_BRANDING.text_label, Validators.required],
    text_caption: [DEFAULT_COMPANY_BRANDING.text_caption, Validators.required],
  });

  readonly emailForm = this.fb.nonNullable.group({
    host: [''],
    port: [587, [Validators.required, Validators.min(1), Validators.max(65535)]],
    use_tls: [true],
    use_ssl: [false],
    username: [''],
    password: [''],
    from_email: ['', [Validators.email]],
    from_name: [''],
    /** Texto editable: correos separados por coma o salto de línea → `default_cc[]`. */
    default_cc: [''],
    /** Por defecto activo: sin esto el envío de cotizaciones falla aunque el test funcione. */
    is_active: [true],
    test_to: ['', [Validators.email]],
  });

  ngOnInit(): void {
    this.reload();
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.items.set([...rows].sort((a, b) => a.id - b.id));
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
    this.editingRow.set(null);
    this.form.reset({ ruc: '', name: '', bank_accounts: '' });
    this.brandingForm.reset({ ...DEFAULT_COMPANY_BRANDING });
    this.resetEmailForm();
    this.clearLogoPick();
    this.modalOpen.set(true);
  }

  openEdit(row: Company): void {
    this.editingId.set(row.id);
    this.editingRow.set(row);
    this.form.patchValue({
      ruc: row.ruc ?? '',
      name: row.name,
      bank_accounts: row.bank_accounts ?? '',
    });
    this.brandingForm.patchValue({
      ...(row.branding ?? DEFAULT_COMPANY_BRANDING),
    });
    this.resetEmailForm();
    this.clearLogoPick();
    this.modalOpen.set(true);
    this.loadEmailSettings(row.id);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.clearLogoPick();
    this.resetEmailForm();
  }

  onLogoFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.revokePreview();
    this.logoFile.set(file);
    if (file && file.type.startsWith('image/')) {
      this.logoPreviewUrl.set(URL.createObjectURL(file));
    } else {
      this.logoPreviewUrl.set(null);
    }
    input.value = '';
  }

  clearLogoPick(): void {
    this.revokePreview();
    this.logoFile.set(null);
    this.logoPreviewUrl.set(null);
  }

  private revokePreview(): void {
    const u = this.logoPreviewUrl();
    if (u?.startsWith('blob:')) {
      URL.revokeObjectURL(u);
    }
  }

  /** Vista previa: archivo nuevo o logo ya guardado en la fila editada. */
  modalPreviewSrc(): string | null {
    const blob = this.logoPreviewUrl();
    if (blob) return blob;
    return this.editingRow()?.logo ?? null;
  }

  save(): void {
    if (this.form.invalid || this.brandingForm.invalid) {
      this.form.markAllAsTouched();
      this.brandingForm.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const ruc = raw.ruc.trim();
    const name = raw.name.trim();
    const bank_accounts = raw.bank_accounts.trim();
    const id = this.editingId();
    const file = this.logoFile();
    const brandingBody = this.brandingForm.getRawValue() as CompanyBranding;

    this.saving.set(true);
    this.errorMessage.set(null);

    const companyReq =
      id == null
        ? this.api.createWithOptionalLogo(ruc, name, bank_accounts, file)
        : this.api.updateWithOptionalLogo(id, ruc, name, bank_accounts, file);

    companyReq.pipe(switchMap((co) => this.api.patchBranding(co.id, brandingBody))).subscribe({
      next: () => {
        this.saving.set(false);
        this.modalOpen.set(false);
        this.clearLogoPick();
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  saveEmailSettings(): void {
    const companyId = this.editingId();
    if (companyId == null) return;
    if (this.emailForm.controls.host.invalid || this.emailForm.controls.port.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    const patch = this.buildEmailSettingsPatch();
    this.emailSettingsSaving.set(true);
    this.emailSettingsError.set(null);
    this.emailSettingsMessage.set(null);
    this.api.patchEmailSettings(companyId, patch).subscribe({
      next: (s) => {
        this.emailSettingsSaving.set(false);
        this.emailPasswordConfigured.set(!!s.password_configured);
        this.emailForm.patchValue({ password: '', is_active: s.is_active });
        this.emailSettingsMessage.set(
          s.is_active
            ? 'Configuración SMTP guardada y activa.'
            : 'SMTP guardado, pero está inactivo. Actívalo para enviar cotizaciones.',
        );
      },
      error: (err) => {
        this.emailSettingsSaving.set(false);
        this.emailSettingsError.set(this.fmt(err));
      },
    });
  }

  /** POST /email-settings/test/ — `{ "to" }`. Si el test OK, activa el SMTP (is_active). */
  testEmailSettings(): void {
    const companyId = this.editingId();
    if (companyId == null) return;
    const to = this.emailForm.controls.test_to.value.trim();
    if (!to || this.emailForm.controls.test_to.invalid) {
      this.emailForm.controls.test_to.markAsTouched();
      this.emailSettingsError.set('Indica un correo válido para la prueba.');
      return;
    }
    this.emailTestBusy.set(true);
    this.emailSettingsError.set(null);
    this.emailSettingsMessage.set(null);
    this.api.testEmailSettings(companyId, to).subscribe({
      next: () => {
        // El test no exige is_active; el envío de cotizaciones sí. Activar tras prueba OK.
        this.api.patchEmailSettings(companyId, { is_active: true }).subscribe({
          next: () => {
            this.emailForm.patchValue({ is_active: true });
            this.emailTestBusy.set(false);
            this.emailSettingsMessage.set(
              `Correo de prueba enviado a ${to}. SMTP activado para cotizaciones.`,
            );
          },
          error: () => {
            this.emailTestBusy.set(false);
            this.emailSettingsMessage.set(
              `Correo de prueba enviado a ${to}. Marca «Activo» y guarda para poder enviar cotizaciones.`,
            );
          },
        });
      },
      error: (err) => {
        this.emailTestBusy.set(false);
        this.emailSettingsError.set(this.fmt(err));
      },
    });
  }

  /** Body completo de PATCH — siempre host/port/tls/usuario/from/default_cc/is_active. */
  private buildEmailSettingsPatch(): Parameters<CompanyService['patchEmailSettings']>[1] {
    const v = this.emailForm.getRawValue();
    const patch: Parameters<CompanyService['patchEmailSettings']>[1] = {
      host: v.host.trim(),
      port: Number(v.port) || 587,
      use_tls: !!v.use_tls,
      use_ssl: !!v.use_ssl,
      username: v.username.trim(),
      from_email: v.from_email.trim(),
      from_name: v.from_name.trim(),
      default_cc: this.parseDefaultCc(v.default_cc),
      is_active: !!v.is_active,
    };
    const pwd = v.password.trim();
    if (pwd) patch.password = pwd;
    return patch;
  }

  private parseDefaultCc(raw: string): string[] {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.includes('@'));
  }

  private formatDefaultCc(list: string[] | undefined): string {
    return (list ?? []).join(', ');
  }

  remove(row: Company): void {
    if (!window.confirm(`¿Eliminar la empresa «${row.name}»?`)) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  private loadEmailSettings(companyId: number): void {
    this.emailSettingsLoading.set(true);
    this.emailSettingsError.set(null);
    this.emailSettingsMessage.set(null);
    this.api.getEmailSettings(companyId).subscribe({
      next: (s) => {
        this.emailSettingsLoading.set(false);
        this.emailPasswordConfigured.set(!!s.password_configured);
        this.emailForm.patchValue({
          host: s.host,
          port: s.port || 587,
          use_tls: s.use_tls,
          use_ssl: s.use_ssl,
          username: s.username,
          password: '',
          from_email: s.from_email,
          from_name: s.from_name,
          default_cc: this.formatDefaultCc(s.default_cc),
          is_active: s.is_active,
          test_to: '',
        });
      },
      error: (err) => {
        this.emailSettingsLoading.set(false);
        // 404 = aún no configurado: dejar formulario vacío
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.emailPasswordConfigured.set(false);
          return;
        }
        this.emailSettingsError.set(this.fmt(err));
      },
    });
  }

  private resetEmailForm(): void {
    this.emailForm.reset({
      host: '',
      port: 587,
      use_tls: true,
      use_ssl: false,
      username: '',
      password: '',
      from_email: '',
      from_name: '',
      default_cc: '',
      is_active: true,
      test_to: '',
    });
    this.emailPasswordConfigured.set(false);
    this.emailSettingsLoading.set(false);
    this.emailSettingsSaving.set(false);
    this.emailTestBusy.set(false);
    this.emailSettingsMessage.set(null);
    this.emailSettingsError.set(null);
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
