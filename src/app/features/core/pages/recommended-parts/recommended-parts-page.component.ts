import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth.service';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import type { SubcategoryRecommendedPart } from '../../../servicios/models/servicios.models';
import { SubcategoryRecommendedPartService } from '../../../servicios/services/subcategory-recommended-part.service';
import { downloadRecommendedPartsExcelTemplate } from './recommended-parts-excel.util';

type CatalogRow = { id: number; name: string };
type SubcategoryRow = CatalogRow & { category: number };

@Component({
  selector: 'app-recommended-parts-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './recommended-parts-page.component.html',
})
export class RecommendedPartsPageComponent implements OnInit {
  private readonly api = inject(SubcategoryRecommendedPartService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<SubcategoryRecommendedPart[]>([]);
  readonly categories = signal<CatalogRow[]>([]);
  readonly subcategories = signal<SubcategoryRow[]>([]);

  readonly filterCategoryId = signal<number | null>(null);
  readonly filterSubcategoryId = signal<number | null>(null);
  readonly filterActiveOnly = signal(true);
  readonly searchQuery = signal('');

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly importBusy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalErrorMessage = signal<string | null>(null);
  readonly importSummary = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly filterSubcategoryOptions = computed(() => {
    const catId = this.filterCategoryId();
    const subs = this.subcategories();
    if (catId == null) return subs;
    return subs.filter((s) => Number(s.category) === Number(catId));
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery();
    const catId = this.filterCategoryId();
    const subId = this.filterSubcategoryId();
    const activeOnly = this.filterActiveOnly();
    const subById = new Map(this.subcategories().map((s) => [s.id, s]));

    return this.items().filter((p) => {
      if (subId != null && p.subcategory !== subId) return false;
      if (catId != null) {
        const sub = subById.get(p.subcategory);
        if (!sub || Number(sub.category) !== Number(catId)) return false;
      }
      if (activeOnly && !p.is_active) return false;
      if (!q.trim()) return true;
      const blob = [
        String(p.id),
        p.name,
        p.description ?? '',
        p.subcategory_name ?? '',
        String(p.subcategory),
      ].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    subcategory: this.fb.control<number | null>(null, Validators.required),
    name: ['', Validators.required],
    description: [''],
    sort_order: this.fb.control<number | null>(1),
    is_active: this.fb.nonNullable.control(true),
  });

  ngOnInit(): void {
    this.loadCatalogs();
    this.reload();
  }

  private loadCatalogs(): void {
    forkJoin({
      categories: this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/categories/`),
      subcategories: this.http.get<Record<string, unknown>[]>(
        `${environment.apiUrl}/subcategories/`,
      ),
    }).subscribe({
      next: ({ categories, subcategories }) => {
        this.categories.set(
          categories.map((r) => ({
            id: Number(r['id']),
            name: String(r['name'] ?? r['id']),
          })),
        );
        const mapped: SubcategoryRow[] = [];
        for (const r of subcategories) {
          const cat = this.fk(r['category'] ?? r['category_id']);
          if (cat == null) continue;
          mapped.push({
            id: Number(r['id']),
            name: String(r['name'] ?? r['id']),
            category: cat,
          });
        }
        this.subcategories.set(mapped);
      },
      error: () => {
        this.showError('No se pudieron cargar categorías/subcategorías.', 'page');
      },
    });
  }

  private fk(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.trim());
      return Number.isNaN(n) ? null : n;
    }
    if (typeof v === 'object' && v !== null && 'id' in v) {
      const n = Number((v as { id: unknown }).id);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  }

  subcategoryLabel(id: number): string {
    return this.subcategories().find((s) => s.id === id)?.name ?? String(id);
  }

  setSearchQuery(v: string): void {
    this.searchQuery.set(v);
  }

  setFilterCategory(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterCategoryId.set(id != null && !Number.isNaN(id) ? id : null);
    const subId = this.filterSubcategoryId();
    if (subId != null) {
      const ok = this.filterSubcategoryOptions().some((s) => s.id === subId);
      if (!ok) this.filterSubcategoryId.set(null);
    }
  }

  setFilterSubcategory(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterSubcategoryId.set(id != null && !Number.isNaN(id) ? id : null);
  }

  setFilterActiveOnly(checked: boolean): void {
    this.filterActiveOnly.set(checked);
  }

  reload(): void {
    this.loading.set(true);
    this.clearErrors('page');
    const subId = this.filterSubcategoryId();
    this.api
      .list({
        subcategory_id: subId ?? undefined,
        is_active: this.filterActiveOnly() ? true : undefined,
      })
      .subscribe({
        next: (rows) => {
          this.items.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.showError(err, 'page');
        },
      });
  }

  openNew(): void {
    if (!this.auth.canWriteRecommendedParts()) return;
    this.editingId.set(null);
    this.clearErrors('modal');
    const first = this.filterSubcategoryId() ?? this.subcategories()[0]?.id ?? null;
    this.form.reset({
      id: null,
      subcategory: first,
      name: '',
      description: '',
      sort_order: 1,
      is_active: true,
    });
    this.modalOpen.set(true);
  }

  openEdit(row: SubcategoryRecommendedPart): void {
    if (!this.auth.canWriteRecommendedParts()) return;
    this.editingId.set(row.id);
    this.clearErrors('modal');
    this.form.patchValue({
      id: row.id,
      subcategory: row.subcategory,
      name: row.name,
      description: row.description ?? '',
      sort_order: row.sort_order,
      is_active: row.is_active,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.clearErrors('modal');
  }

  save(): void {
    if (!this.auth.canWriteRecommendedParts()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.subcategory == null) {
      this.form.markAllAsTouched();
      return;
    }
    const payload = {
      subcategory: v.subcategory,
      name: v.name.trim(),
      description: v.description.trim() || null,
      sort_order: v.sort_order ?? 0,
      is_active: v.is_active,
    };
    const id = this.editingId();
    this.saving.set(true);
    this.clearErrors('modal');
    const req = id == null ? this.api.create(payload) : this.api.update(id, payload);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.showError(err, 'modal');
      },
    });
  }

  remove(row: SubcategoryRecommendedPart): void {
    if (!this.auth.canWriteRecommendedParts()) return;
    if (!window.confirm(`¿Eliminar la parte recomendada «${row.name}»?`)) return;
    this.clearErrors('page');
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.showError(err, 'page'),
    });
  }

  downloadTemplate(): void {
    downloadRecommendedPartsExcelTemplate();
  }

  onExcelSelected(ev: Event): void {
    if (!this.auth.canWriteRecommendedParts()) return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.importBusy.set(true);
    this.importSummary.set(null);
    this.clearErrors('page');
    this.api.importExcel(file).subscribe({
      next: (res) => {
        this.importBusy.set(false);
        const created = res.created ?? 0;
        const updated = res.updated ?? 0;
        const failed = res.failed ?? 0;
        this.importSummary.set(
          res.detail?.trim() ||
            `Importación: ${created} altas, ${updated} actualizaciones` +
              (failed ? `, ${failed} con error` : '') +
              '.',
        );
        this.reload();
      },
      error: (err) => {
        this.importBusy.set(false);
        this.showError(err, 'page');
      },
    });
  }

  private showError(err: unknown, where: 'page' | 'modal' | 'auto' = 'auto'): void {
    const msg = typeof err === 'string' ? err : formatHttpError(err);
    const scope = where === 'auto' ? (this.modalOpen() ? 'modal' : 'page') : where;
    if (scope === 'modal') {
      this.modalErrorMessage.set(msg);
    } else {
      this.errorMessage.set(msg);
    }
  }

  private clearErrors(where: 'page' | 'modal' | 'all' = 'all'): void {
    if (where === 'page' || where === 'all') this.errorMessage.set(null);
    if (where === 'modal' || where === 'all') this.modalErrorMessage.set(null);
  }
}
