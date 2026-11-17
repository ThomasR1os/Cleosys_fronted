import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
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
import {
  downloadBrandsExcel,
  downloadBrandsExcelTemplate,
  parseBrandsExcel,
  type BrandExcelIssue,
} from './brand-excel.util';

type Row = Record<string, unknown>;

type BrandImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: BrandExcelIssue[];
};

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
  readonly auth = inject(AuthService);

  /**
   * Marcas: Almacén, Logística, Servicios o Admin.
   * El resto de catálogos de esta pantalla no cambia de criterio.
   */
  readonly canMutate = computed(() =>
    this.catalogKey() === 'brands' ? this.auth.canWriteBrands() : true,
  );

  readonly items = signal<Row[]>([]);
  readonly searchQuery = signal('');
  /** Página actual (0-based). */
  readonly pageIndex = signal(0);
  /** Filas por página. */
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly filteredItems = computed(() => {
    const raw = this.searchQuery().trim();
    const rows = this.items();
    if (!raw || !this.def) return rows;
    const keys = this.def.listColumns.map((c) => c.key);
    return rows.filter((r) => {
      const haystack = keys.map((k) => String(r[k] ?? '')).join(' ');
      return textMatchesLooseQuery(haystack, raw);
    });
  });

  readonly totalCount = computed(() => this.filteredItems().length);
  readonly totalLoaded = computed(() => this.items().length);
  readonly totalPages = computed(() => {
    const n = this.totalCount();
    const ps = this.pageSize();
    if (n === 0) return 0;
    return Math.ceil(n / ps);
  });
  readonly pagedItems = computed(() => {
    const all = this.filteredItems();
    const ps = this.pageSize();
    const start = this.pageIndex() * ps;
    return all.slice(start, start + ps);
  });

  readonly hasActiveSearch = computed(() => this.searchQuery().trim() !== '');
  readonly rangeStart = computed(() => {
    const n = this.totalCount();
    if (n === 0) return 0;
    return this.pageIndex() * this.pageSize() + 1;
  });
  readonly rangeEnd = computed(() => {
    const n = this.totalCount();
    if (n === 0) return 0;
    return Math.min((this.pageIndex() + 1) * this.pageSize(), n);
  });

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly selectOptions = signal<Record<string, { value: number; label: string }[]>>({});

  /** Solo Marcas: importación Excel. */
  readonly importBusy = signal(false);
  readonly importProgress = signal<{ done: number; total: number } | null>(null);
  readonly importSummary = signal<BrandImportSummary | null>(null);

  readonly isBrands = computed(() => this.catalogKey() === 'brands');

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

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.pageIndex.set(0);
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.pageIndex.set(0);
  }

  prevPage(): void {
    this.pageIndex.update((i) => Math.max(0, i - 1));
  }

  nextPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    this.pageIndex.update((i) => Math.min(last, i + 1));
  }

  private clampPageIndex(): void {
    const tp = this.totalPages();
    if (tp === 0) {
      this.pageIndex.set(0);
      return;
    }
    if (this.pageIndex() >= tp) {
      this.pageIndex.set(tp - 1);
    }
  }

  searchPlaceholder(): string {
    if (!this.def) return 'Buscar…';
    const labels = this.def.listColumns.map((c) => c.label.toLowerCase());
    return labels.length ? `${labels.join(', ')}…` : 'Buscar…';
  }

  downloadBrandsExport(): void {
    if (!this.isBrands()) return;
    const rows = this.items()
      .map((r) => ({
        id: r['id'] as number | string,
        name: String(r['name'] ?? '').trim(),
      }))
      .filter((r) => r.name !== '' || r.id != null);
    if (!rows.length) {
      this.errorMessage.set('No hay marcas para exportar.');
      return;
    }
    downloadBrandsExcel(rows);
  }

  downloadBrandsTemplate(): void {
    if (!this.isBrands() || !this.canMutate()) return;
    downloadBrandsExcelTemplate();
  }

  async onBrandsExcelSelected(event: Event): Promise<void> {
    if (!this.isBrands() || !this.canMutate()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importSummary.set(null);
    this.importProgress.set(null);
    this.errorMessage.set(null);
    this.importBusy.set(true);

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseBrandsExcel(buf);
      if (!parsed.ok) {
        this.errorMessage.set(parsed.error);
        return;
      }

      const existingById = new Map<number, Row>();
      const existingByName = new Map<string, Row>();
      for (const row of this.items()) {
        const id = Number(row['id']);
        if (Number.isFinite(id)) existingById.set(id, row);
        const name = String(row['name'] ?? '')
          .trim()
          .toLowerCase();
        if (name) existingByName.set(name, row);
      }

      const urlBase = `${environment.apiUrl}/${this.def.apiPath}/`;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: BrandExcelIssue[] = [];
      const total = parsed.rows.length;

      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        this.importProgress.set({ done: i + 1, total });
        const label = `Fila ${row.excelRow} · ${row.name}`;
        const nameKey = row.name.toLowerCase();

        try {
          if (row.id != null) {
            const byId = existingById.get(row.id);
            if (byId) {
              const currentName = String(byId['name'] ?? '').trim();
              if (currentName.toLowerCase() === nameKey) {
                skipped += 1;
                continue;
              }
              await lastValueFrom(
                this.http.patch<Row>(`${urlBase}${row.id}/`, { name: row.name }),
              );
              byId['name'] = row.name;
              existingByName.delete(currentName.toLowerCase());
              existingByName.set(nameKey, byId);
              updated += 1;
              continue;
            }
            const createdRow = await lastValueFrom(
              this.http.post<Row>(urlBase, { id: row.id, name: row.name }),
            );
            existingById.set(row.id, createdRow);
            existingByName.set(nameKey, createdRow);
            created += 1;
            continue;
          }

          const byName = existingByName.get(nameKey);
          if (byName) {
            skipped += 1;
            continue;
          }
          const createdRow = await lastValueFrom(
            this.http.post<Row>(urlBase, { name: row.name }),
          );
          const newId = Number(createdRow['id']);
          if (Number.isFinite(newId)) existingById.set(newId, createdRow);
          existingByName.set(nameKey, createdRow);
          created += 1;
        } catch (err) {
          errors.push({ label, message: this.formatError(err) });
        }
      }

      this.importSummary.set({
        created,
        updated,
        skipped,
        failed: errors.length,
        errors: [...parsed.issues, ...errors],
      });
      this.reload();
    } finally {
      this.importBusy.set(false);
      this.importProgress.set(null);
      input.value = '';
    }
  }

  reload(): void {
    const d = this.def;
    if (!d) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.http.get<Row[]>(`${environment.apiUrl}/${d.apiPath}/`).subscribe({
      next: (rows) => {
        this.items.set(this.normalizeRows(rows));
        this.clampPageIndex();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  openNew(): void {
    if (!this.canMutate()) return;
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
    if (!this.canMutate()) return;
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
    if (!this.canMutate()) return;
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
    return this.normalizePayload(out);
  }

  /**
   * Compatibilidad temporal: algunos catálogos tuvieron typos en claves.
   * Solo aplicamos alias en claves conocidas para no tocar otros recursos.
   */
  private normalizeRows(rows: Row[]): Row[] {
    if (this.def.apiPath !== 'units') return rows;
    return rows.map((r) => {
      const out: Row = { ...r };
      if (out['abbreviation'] == null && out['abreviation'] != null) {
        out['abbreviation'] = out['abreviation'];
      }
      return out;
    });
  }

  private normalizePayload(payload: Row): Row {
    if (this.def.apiPath !== 'units') return payload;
    const out: Row = { ...payload };
    if ('abbreviation' in out) {
      out['abreviation'] = out['abbreviation'];
    }
    return out;
  }

  remove(row: Row): void {
    if (!this.canMutate()) return;
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
