import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { ShortDateTimePipe } from '../../../../core/pipes/short-datetime.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { ClientService } from '../../../ventas/services/client.service';
import type {
  ControlVoltage,
  ElectricalEvaluation,
  ElectricalEvaluationWritePayload,
  Machine,
  MachineStatus,
  MachineWritePayload,
  NominalVoltage,
  StarterType,
} from '../../models/servicios.models';
import { MachineService } from '../../services/machine.service';

type ClientOption = { id: number; name: string; ruc?: string };
type BrandOption = { id: number; name: string };
type CatalogOption = { id: number; name: string };
type SubcategoryOption = CatalogOption & { category: number };

type StatusFilter = 'ALL' | MachineStatus;

const PICKER_PAGE = 100;

const EMPTY_EVAL = {
  nominal_voltage: '' as string,
  actual_l1_l2: null as number | null,
  actual_l2_l3: null as number | null,
  actual_l3_l1: null as number | null,
  main_l1: null as number | null,
  main_l2: null as number | null,
  main_l3: null as number | null,
  fan_l1: null as number | null,
  fan_l2: null as number | null,
  fan_l3: null as number | null,
  starter_type: '' as string,
  starter_brand: '',
  control_voltage: '' as string,
  grounding: '',
};

@Component({
  selector: 'app-maquinarias-page',
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe, ShortDateTimePipe],
  templateUrl: './maquinarias-page.component.html',
})
export class MaquinariasPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(MachineService);
  private readonly clientsApi = inject(ClientService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<Machine[]>([]);
  readonly clients = signal<ClientOption[]>([]);
  readonly brands = signal<BrandOption[]>([]);
  readonly categories = signal<CatalogOption[]>([]);
  readonly subcategories = signal<SubcategoryOption[]>([]);

  readonly searchQuery = signal('');
  readonly filterClientId = signal<number | null>(null);
  readonly filterBrandId = signal<number | null>(null);
  readonly filterStatus = signal<StatusFilter>('ACTIVE');
  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalErrorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly clientSearchQuery = signal('');
  readonly brandSearchQuery = signal('');
  readonly clientPickerOpen = signal(false);
  readonly brandPickerOpen = signal(false);

  readonly plateFileName = signal<string | null>(null);
  readonly platePreviewSrc = signal<string | null>(null);
  readonly existingPlateUrl = signal<string | null>(null);
  private pendingPlateFile: File | null = null;

  readonly filteredClientOptions = computed(() => {
    const q = this.clientSearchQuery().trim().toLowerCase();
    const all = this.clients();
    const list = !q
      ? all
      : all.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.ruc && c.ruc.toLowerCase().includes(q)) ||
            String(c.id).includes(q),
        );
    return list.slice(0, PICKER_PAGE);
  });

  readonly filteredBrandOptions = computed(() => {
    const q = this.brandSearchQuery().trim().toLowerCase();
    const all = this.brands();
    const list = !q
      ? all
      : all.filter(
          (b) => b.name.toLowerCase().includes(q) || String(b.id).includes(q),
        );
    return list.slice(0, PICKER_PAGE);
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery();
    const clientId = this.filterClientId();
    const brandId = this.filterBrandId();
    const status = this.filterStatus();
    const clientById = new Map(this.clients().map((c) => [c.id, c.name]));
    const brandById = new Map(this.brands().map((b) => [b.id, b.name]));

    return this.items().filter((m) => {
      if (clientId != null && m.client !== clientId) return false;
      if (brandId != null && m.brand !== brandId) return false;
      if (status !== 'ALL' && (m.status || 'ACTIVE') !== status) return false;
      if (!q.trim()) return true;
      const ev = m.electrical_evaluation;
      const blob = [
        String(m.id),
        m.model,
        m.serial_number,
        m.location,
        m.status ?? '',
        m.category_name ?? '',
        m.subcategory_name ?? '',
        m.plate_image_url ?? '',
        m.daily_working_hours,
        m.current_hour_meter ?? '',
        clientById.get(m.client) ?? m.client_name ?? '',
        brandById.get(m.brand) ?? m.brand_name ?? '',
        ev?.nominal_voltage ?? '',
        ev?.starter_type ?? '',
        ev?.starter_brand ?? '',
        ev?.control_voltage ?? '',
        ev?.grounding ?? '',
      ].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

  formSubcategoryOptions(): SubcategoryOption[] {
    const catId = this.form.controls.category.value;
    const subs = this.subcategories();
    if (catId == null) return [];
    return subs.filter((s) => Number(s.category) === Number(catId));
  }

  readonly totalFiltered = computed(() => this.filteredItems().length);

  readonly hasActiveFilters = computed(() => {
    return (
      !!this.searchQuery().trim() ||
      this.filterClientId() != null ||
      this.filterBrandId() != null ||
      this.filterStatus() !== 'ACTIVE'
    );
  });

  readonly totalPages = computed(() => {
    const n = this.totalFiltered();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(n / size) || 1);
  });

  readonly pagedItems = computed(() => {
    const list = this.filteredItems();
    const size = this.pageSize();
    const page = this.currentPage();
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  readonly rangeLabel = computed(() => {
    const total = this.totalFiltered();
    if (total === 0) return '0 resultados';
    const size = this.pageSize();
    const page = this.currentPage();
    const start = (page - 1) * size + 1;
    const end = Math.min(page * size, total);
    return `${start}–${end} de ${total}`;
  });

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    client: this.fb.control<number | null>(null, Validators.required),
    brand: this.fb.control<number | null>(null, Validators.required),
    category: this.fb.control<number | null>(null),
    subcategory: this.fb.control<number | null>(null),
    model: ['', Validators.required],
    serial_number: ['', Validators.required],
    daily_working_hours: this.fb.control<number | null>(8, [
      Validators.required,
      Validators.min(0),
    ]),
    current_hour_meter: this.fb.control<number | null>(null),
    location: ['', Validators.required],
    status: this.fb.nonNullable.control<string>('ACTIVE'),
    eval: this.fb.nonNullable.group({
      nominal_voltage: this.fb.nonNullable.control<string>(''),
      actual_l1_l2: this.fb.control<number | null>(null),
      actual_l2_l3: this.fb.control<number | null>(null),
      actual_l3_l1: this.fb.control<number | null>(null),
      main_l1: this.fb.control<number | null>(null),
      main_l2: this.fb.control<number | null>(null),
      main_l3: this.fb.control<number | null>(null),
      fan_l1: this.fb.control<number | null>(null),
      fan_l2: this.fb.control<number | null>(null),
      fan_l3: this.fb.control<number | null>(null),
      starter_type: this.fb.nonNullable.control<string>(''),
      starter_brand: [''],
      control_voltage: this.fb.nonNullable.control<string>(''),
      grounding: [''],
    }),
  });

  readonly statusOptions: { value: MachineStatus; label: string }[] = [
    { value: 'ACTIVE', label: 'Activa' },
    { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
    { value: 'DECOMMISSIONED', label: 'Dada de baja' },
  ];

  readonly nominalVoltageOptions: { value: NominalVoltage; label: string }[] = [
    { value: '220V', label: '220 V' },
    { value: '380V', label: '380 V' },
    { value: '440V', label: '440 V' },
  ];

  readonly starterTypeOptions: { value: StarterType; label: string }[] = [
    { value: 'DIRECT', label: 'Directo' },
    { value: 'STAR_DELTA', label: 'Estrella-triángulo' },
    { value: 'VSD', label: 'VSD' },
    { value: 'SOFT', label: 'SOFT' },
  ];

  readonly controlVoltageOptions: { value: ControlVoltage; label: string }[] = [
    { value: '110_VAC', label: '110 VAC' },
    { value: '220_VAC', label: '220 VAC' },
    { value: '24_VDC', label: '24 VDC' },
  ];

  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  constructor() {
    effect(() => {
      const total = this.totalFiltered();
      const size = this.pageSize();
      const maxPage = Math.max(1, Math.ceil(total / size) || 1);
      const cp = this.currentPage();
      if (cp > maxPage) {
        this.currentPage.set(maxPage);
      }
    });
  }

  ngOnInit(): void {
    this.loadLookups();
    this.reload();
  }

  ngOnDestroy(): void {
    this.revokePlatePreview();
  }

  get evalGroup() {
    return this.form.controls.eval;
  }

  plateDisplaySrc(): string | null {
    return this.platePreviewSrc() || this.existingPlateUrl();
  }

  private loadLookups(): void {
    forkJoin({
      clients: this.clientsApi.listForCompany(),
      brands: this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/brands/`),
      categories: this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/categories/`),
      subcategories: this.http.get<Record<string, unknown>[]>(
        `${environment.apiUrl}/subcategories/`,
      ),
    }).subscribe({
      next: ({ clients, brands, categories, subcategories }) => {
        this.clients.set(
          clients.map((c) => ({
            id: c.id,
            name: c.name || String(c.id),
            ruc: c.ruc,
          })),
        );
        this.brands.set(
          brands.map((r) => ({
            id: Number(r['id']),
            name: String(r['name'] ?? r['id']),
          })),
        );
        this.categories.set(
          categories.map((r) => ({
            id: Number(r['id']),
            name: String(r['name'] ?? r['id']),
          })),
        );
        const mapped: SubcategoryOption[] = [];
        for (const r of subcategories) {
          const cat = this.fkFromUnknown(r['category'] ?? r['category_id']);
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
        this.showError('No se pudieron cargar catálogos (clientes, marcas o categorías).', 'page');
      },
    });
  }

  private fkFromUnknown(v: unknown): number | null {
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

  onCategoryChange(): void {
    const cat = this.form.controls.category.value;
    const sub = this.form.controls.subcategory.value;
    if (sub == null) return;
    const ok = this.subcategories().some(
      (s) => s.id === Number(sub) && Number(s.category) === Number(cat),
    );
    if (!ok) this.form.patchValue({ subcategory: null });
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  setFilterClient(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterClientId.set(id != null && !Number.isNaN(id) ? id : null);
    this.currentPage.set(1);
  }

  setFilterBrand(value: string): void {
    const id = value === '' ? null : Number(value);
    this.filterBrandId.set(id != null && !Number.isNaN(id) ? id : null);
    this.currentPage.set(1);
  }

  setFilterStatus(value: string): void {
    const next: StatusFilter =
      value === 'ACTIVE' || value === 'OUT_OF_SERVICE' || value === 'DECOMMISSIONED'
        ? value
        : 'ALL';
    this.filterStatus.set(next);
    this.currentPage.set(1);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.filterClientId.set(null);
    this.filterBrandId.set(null);
    this.filterStatus.set('ACTIVE');
    this.currentPage.set(1);
  }

  setPageSize(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(n);
    this.currentPage.set(1);
  }

  goPage(delta: number): void {
    const next = this.currentPage() + delta;
    const max = this.totalPages();
    this.currentPage.set(Math.min(max, Math.max(1, next)));
  }

  clientName(row: Machine): string {
    const fromList = this.clients().find((c) => c.id === row.client)?.name;
    return fromList || row.client_name?.trim() || '—';
  }

  brandName(row: Machine): string {
    const fromList = this.brands().find((b) => b.id === row.brand)?.name;
    return fromList || row.brand_name?.trim() || '—';
  }

  statusLabel(status: string): string {
    return this.statusOptions.find((o) => o.value === status)?.label ?? status;
  }

  nominalVoltageLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return this.nominalVoltageOptions.find((o) => o.value === value)?.label ?? value;
  }

  lastTouchedAt(row: Machine): string | null {
    return row.updated_at || row.created_at || null;
  }

  clientLabel(c: ClientOption): string {
    return `${c.name}${c.ruc ? ` · ${c.ruc}` : ''}`;
  }

  onClientSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.clientSearchQuery.set(v);
    this.clientPickerOpen.set(true);
    const current = this.form.controls.client.value;
    if (current != null) {
      const selected = this.clients().find((c) => c.id === current);
      if (!selected || this.clientLabel(selected) !== v) {
        this.form.patchValue({ client: null });
      }
    }
  }

  openClientPicker(): void {
    this.clientPickerOpen.set(true);
  }

  closeClientPickerSoon(): void {
    setTimeout(() => this.clientPickerOpen.set(false), 180);
  }

  selectClient(c: ClientOption): void {
    this.form.patchValue({ client: c.id });
    this.clientSearchQuery.set(this.clientLabel(c));
    this.clientPickerOpen.set(false);
  }

  onBrandSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.brandSearchQuery.set(v);
    this.brandPickerOpen.set(true);
    const current = this.form.controls.brand.value;
    if (current != null) {
      const selected = this.brands().find((b) => b.id === current);
      if (!selected || selected.name !== v) {
        this.form.patchValue({ brand: null });
      }
    }
  }

  openBrandPicker(): void {
    this.brandPickerOpen.set(true);
  }

  closeBrandPickerSoon(): void {
    setTimeout(() => this.brandPickerOpen.set(false), 180);
  }

  selectBrand(b: BrandOption): void {
    this.form.patchValue({ brand: b.id });
    this.brandSearchQuery.set(b.name);
    this.brandPickerOpen.set(false);
  }

  onPlateFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.revokePlatePreview();
    this.pendingPlateFile = null;
    this.plateFileName.set(null);
    this.platePreviewSrc.set(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.showError('La placa debe ser una imagen (PNG, JPG, etc.).', 'modal');
      return;
    }
    this.pendingPlateFile = file;
    this.plateFileName.set(file.name);
    this.platePreviewSrc.set(URL.createObjectURL(file));
  }

  clearPlatePick(): void {
    this.revokePlatePreview();
    this.pendingPlateFile = null;
    this.plateFileName.set(null);
    this.platePreviewSrc.set(null);
  }

  private revokePlatePreview(): void {
    const u = this.platePreviewSrc();
    if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  }

  private resetPlateState(existingUrl: string | null = null): void {
    this.clearPlatePick();
    this.existingPlateUrl.set(existingUrl);
  }

  private syncPickerLabels(clientId: number | null, brandId: number | null): void {
    const client = clientId != null ? this.clients().find((c) => c.id === clientId) : null;
    const brand = brandId != null ? this.brands().find((b) => b.id === brandId) : null;
    this.clientSearchQuery.set(client ? this.clientLabel(client) : '');
    this.brandSearchQuery.set(brand ? brand.name : '');
    this.clientPickerOpen.set(false);
    this.brandPickerOpen.set(false);
  }

  private patchEvalFromApi(ev: ElectricalEvaluation | null): void {
    if (!ev) {
      this.evalGroup.reset({ ...EMPTY_EVAL });
      return;
    }
    this.evalGroup.patchValue({
      nominal_voltage: ev.nominal_voltage ?? '',
      actual_l1_l2: ev.actual_voltage?.l1_l2 ?? null,
      actual_l2_l3: ev.actual_voltage?.l2_l3 ?? null,
      actual_l3_l1: ev.actual_voltage?.l3_l1 ?? null,
      main_l1: ev.main_motor_current?.l1 ?? null,
      main_l2: ev.main_motor_current?.l2 ?? null,
      main_l3: ev.main_motor_current?.l3 ?? null,
      fan_l1: ev.fan_motor_current?.l1 ?? null,
      fan_l2: ev.fan_motor_current?.l2 ?? null,
      fan_l3: ev.fan_motor_current?.l3 ?? null,
      starter_type: ev.starter_type ?? '',
      starter_brand: ev.starter_brand ?? '',
      control_voltage: ev.control_voltage ?? '',
      grounding: ev.grounding ?? '',
    });
  }

  private buildElectricalPayload(): ElectricalEvaluationWritePayload | null {
    const e = this.evalGroup.getRawValue();
    const nominal = this.nullIfBlank(e.nominal_voltage);
    const starterType = this.nullIfBlank(e.starter_type);
    const starterBrand = this.nullIfBlank(e.starter_brand);
    const control = this.nullIfBlank(e.control_voltage);
    const grounding = this.nullIfBlank(e.grounding);

    const actual = this.buildPhaseLine(e.actual_l1_l2, e.actual_l2_l3, e.actual_l3_l1);
    const main = this.buildPhaseCurrent(e.main_l1, e.main_l2, e.main_l3);
    const fan = this.buildPhaseCurrent(e.fan_l1, e.fan_l2, e.fan_l3);

    if (!nominal && !starterType && !starterBrand && !control && !grounding && !actual && !main && !fan) {
      return null;
    }

    const payload: ElectricalEvaluationWritePayload = {};
    if (nominal) payload.nominal_voltage = nominal;
    if (actual) payload.actual_voltage = actual;
    if (main) payload.main_motor_current = main;
    if (fan) payload.fan_motor_current = fan;
    if (starterType) payload.starter_type = starterType;
    if (starterBrand) payload.starter_brand = starterBrand;
    if (control) payload.control_voltage = control;
    if (grounding) payload.grounding = grounding;
    return payload;
  }

  private buildPhaseLine(
    l1_l2: number | null,
    l2_l3: number | null,
    l3_l1: number | null,
  ): { l1_l2?: number; l2_l3?: number; l3_l1?: number } | null {
    const a = this.nullIfDecimal(l1_l2);
    const b = this.nullIfDecimal(l2_l3);
    const c = this.nullIfDecimal(l3_l1);
    if (a == null && b == null && c == null) return null;
    const o: { l1_l2?: number; l2_l3?: number; l3_l1?: number } = {};
    if (a != null) o.l1_l2 = a;
    if (b != null) o.l2_l3 = b;
    if (c != null) o.l3_l1 = c;
    return o;
  }

  private buildPhaseCurrent(
    l1: number | null,
    l2: number | null,
    l3: number | null,
  ): { l1?: number; l2?: number; l3?: number } | null {
    const a = this.nullIfDecimal(l1);
    const b = this.nullIfDecimal(l2);
    const c = this.nullIfDecimal(l3);
    if (a == null && b == null && c == null) return null;
    const o: { l1?: number; l2?: number; l3?: number } = {};
    if (a != null) o.l1 = a;
    if (b != null) o.l2 = b;
    if (c != null) o.l3 = c;
    return o;
  }

  reload(): void {
    this.loading.set(true);
    this.clearErrors('page');
    this.api.list().subscribe({
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
    this.editingId.set(null);
    this.clearErrors('modal');
    this.resetPlateState(null);
    this.form.reset({
      id: null,
      client: null,
      brand: null,
      category: null,
      subcategory: null,
      model: '',
      serial_number: '',
      daily_working_hours: 8,
      current_hour_meter: null,
      location: '',
      status: 'ACTIVE',
      eval: { ...EMPTY_EVAL },
    });
    this.syncPickerLabels(null, null);
    this.modalOpen.set(true);
  }

  openEdit(row: Machine): void {
    this.editingId.set(row.id);
    this.clearErrors('modal');
    this.resetPlateState(row.plate_image_url);
    this.form.patchValue({
      id: row.id,
      client: row.client || null,
      brand: row.brand || null,
      category: row.category,
      subcategory: row.subcategory,
      model: row.model,
      serial_number: row.serial_number,
      daily_working_hours: row.daily_working_hours,
      current_hour_meter: row.current_hour_meter,
      location: row.location,
      status: row.status || 'ACTIVE',
    });
    this.patchEvalFromApi(row.electrical_evaluation);
    this.syncPickerLabels(row.client || null, row.brand || null);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.clearErrors('modal');
    this.clearPlatePick();
    this.clientPickerOpen.set(false);
    this.brandPickerOpen.set(false);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.client == null || v.brand == null || v.daily_working_hours == null) {
      this.form.markAllAsTouched();
      return;
    }
    const electrical = this.buildElectricalPayload();
    const payload: MachineWritePayload = {
      client: v.client,
      brand: v.brand,
      category: v.category,
      subcategory: v.subcategory,
      model: v.model.trim(),
      serial_number: v.serial_number.trim(),
      daily_working_hours: v.daily_working_hours,
      current_hour_meter: this.nullIfDecimal(v.current_hour_meter),
      location: v.location.trim(),
      status: v.status?.trim() || 'ACTIVE',
    };
    if (electrical) {
      payload.electrical_evaluation = electrical;
    }
    const id = this.editingId();
    const plateFile = this.pendingPlateFile;
    this.saving.set(true);
    this.clearErrors('modal');
    const req =
      id == null
        ? this.api.createWithOptionalPlate(payload, plateFile)
        : this.api.updateWithOptionalPlate(id, payload, plateFile);
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

  remove(row: Machine): void {
    if (
      !window.confirm(
        `¿Eliminar la maquinaria #${row.id} (${row.model} / ${row.serial_number})?`,
      )
    ) {
      return;
    }
    this.clearErrors('page');
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.showError(err, 'page'),
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

  private nullIfBlank(s: string | null | undefined): string | null {
    if (s == null) return null;
    const t = String(s).trim();
    return t === '' ? null : t;
  }

  private nullIfDecimal(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    const t = String(v).trim();
    if (t === '') return null;
    const n = Number(t.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }
}
