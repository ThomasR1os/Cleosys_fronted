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
    this.clearLogoPick();
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.clearLogoPick();
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

  remove(row: Company): void {
    if (!window.confirm(`¿Eliminar la empresa «${row.name}»?`)) return;
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
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
