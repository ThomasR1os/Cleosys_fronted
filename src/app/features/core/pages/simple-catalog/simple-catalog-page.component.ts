import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { environment } from '../../../../../environments/environment';
import {
  CATALOG_REGISTRY,
  type CatalogDefinition,
  type CatalogRegistryKey,
} from '../../catalog/catalog-config';

type Row = Record<string, unknown>;

@Component({
  selector: 'app-simple-catalog-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './simple-catalog-page.component.html',
})
export class SimpleCatalogPageComponent implements OnInit {
  /** Enlazado desde `data: { catalogKey }` vía `withComponentInputBinding`. */
  readonly catalogKey = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly items = signal<Row[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly selectOptions = signal<Record<string, { value: number; label: string }[]>>({});

  form!: FormGroup;
  def!: CatalogDefinition;

  ngOnInit(): void {
    const key = this.catalogKey() as CatalogRegistryKey;
    const d = CATALOG_REGISTRY[key];
    if (!d) {
      this.errorMessage.set(`Catálogo desconocido: ${key}`);
      return;
    }
    this.def = d;
    this.form = this.buildEmptyForm(d);
    this.loadSelectOptions(d);
    this.reload();
  }

  private buildEmptyForm(d: CatalogDefinition): FormGroup {
    const controls: Record<string, FormControl> = {};
    /** Opcional en alta si el backend exige un id explícito; no se declara en cada catálogo. */
    controls['id'] = this.fb.control<number | null>(null);
    for (const f of d.formFields) {
      const validators = f.required ? [Validators.required] : [];
      if (f.type === 'number') {
        controls[f.key] = this.fb.control<number | null>(null, validators);
      } else if (f.type === 'select') {
        controls[f.key] = this.fb.control<number | null>(null, validators);
      } else {
        controls[f.key] = this.fb.control<string>('', validators);
      }
    }
    return this.fb.group(controls);
  }

  private loadSelectOptions(d: CatalogDefinition): void {
    const selects = d.formFields.filter((f) => f.type === 'select' && f.optionsFrom);
    for (const f of selects) {
      const path = f.optionsFrom!;
      this.http.get<Row[]>(`${environment.apiUrl}/${path}/`).subscribe({
        next: (rows) => {
          const opts = rows.map((r) => ({
            value: r['id'] as number,
            label: String(r['name'] ?? r['id']),
          }));
          this.selectOptions.update((m) => ({ ...m, [path]: opts }));
        },
        error: () => {
          this.errorMessage.set(`No se pudieron cargar opciones (${path}).`);
        },
      });
    }
  }

  reload(): void {
    const d = this.def;
    if (!d) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.http.get<Row[]>(`${environment.apiUrl}/${d.apiPath}/`).subscribe({
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
    this.form.reset();
    this.form.get('id')?.setValue(null);
    for (const f of this.def.formFields) {
      if (f.type === 'number' || f.type === 'select') {
        this.form.get(f.key)?.setValue(null);
      } else {
        this.form.get(f.key)?.setValue('');
      }
    }
    this.modalOpen.set(true);
  }

  openEdit(row: Row): void {
    const id = row['id'] as number;
    this.editingId.set(id);
    this.form.get('id')?.setValue(row['id'] != null ? Number(row['id']) : null);
    for (const f of this.def.formFields) {
      const raw = row[f.key];
      if (f.type === 'number') {
        this.form.get(f.key)?.setValue(raw != null ? Number(raw) : null);
      } else if (f.type === 'select') {
        this.form.get(f.key)?.setValue(raw != null ? Number(raw) : null);
      } else {
        this.form.get(f.key)?.setValue(raw != null ? String(raw) : '');
      }
    }
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
    const raw = this.form.getRawValue() as Row;
    const id = this.editingId();
    const payload = this.buildPayload(raw, id == null);
    this.saving.set(true);
    this.errorMessage.set(null);
    const urlBase = `${environment.apiUrl}/${this.def.apiPath}/`;
    const req =
      id == null
        ? this.http.post<Row>(urlBase, payload)
        : this.http.patch<Row>(`${urlBase}${id}/`, payload);
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

  private buildPayload(raw: Row, isCreate: boolean): Row {
    const out: Row = {};
    if (isCreate) {
      const idVal = raw['id'];
      if (idVal != null && idVal !== '') {
        out['id'] = typeof idVal === 'number' ? idVal : Number(idVal);
      }
    }
    for (const f of this.def.formFields) {
      const v = raw[f.key];
      if (f.type === 'number' || f.type === 'select') {
        if (v != null && v !== '') {
          out[f.key] = typeof v === 'number' ? v : Number(v);
        }
      } else {
        out[f.key] = v ?? '';
      }
    }
    return out;
  }

  remove(row: Row): void {
    const id = row['id'] as number;
    const name = String(row['name'] ?? id);
    if (!window.confirm(`¿Eliminar "${name}"?`)) return;
    this.errorMessage.set(null);
    this.http.delete(`${environment.apiUrl}/${this.def.apiPath}/${id}/`).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.formatError(err)),
    });
  }

  optionsFor(fieldKey: string): { value: number; label: string }[] {
    const f = this.def.formFields.find((x) => x.key === fieldKey);
    if (!f?.optionsFrom) return [];
    return this.selectOptions()[f.optionsFrom] ?? [];
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
