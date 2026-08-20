import { HttpClient, HttpErrorResponse } from '@angular/common/http';
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
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { ClientService } from '../../../ventas/services/client.service';
import type { Machine, MachineStatus, MachineWritePayload } from '../../models/servicios.models';
import { MachineService } from '../../services/machine.service';

type ClientOption = { id: number; name: string; ruc?: string };
type BrandOption = { id: number; name: string };

type StatusFilter = 'ALL' | MachineStatus;

const PICKER_PAGE = 100;

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

  readonly searchQuery = signal('');
  readonly filterClientId = signal<number | null>(null);
  readonly filterBrandId = signal<number | null>(null);
  readonly filterStatus = signal<StatusFilter>('ACTIVE');
  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  /** Dropdowns con buscador (cliente / marca). */
  readonly clientSearchQuery = signal('');
  readonly brandSearchQuery = signal('');
  readonly clientPickerOpen = signal(false);
  readonly brandPickerOpen = signal(false);

  /** Placa: archivo pendiente + preview (Cloudinary tras guardar). */
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
      const blob = [
        String(m.id),
        m.model,
        m.serial_number,
        m.location,
        m.status ?? '',
        m.plate_image_url ?? '',
        m.daily_working_hours,
        m.current_hour_meter ?? '',
        clientById.get(m.client) ?? m.client_name ?? '',
        brandById.get(m.brand) ?? m.brand_name ?? '',
      ].join(' ');
      return textMatchesLooseQuery(blob, q);
    });
  });

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
    model: ['', Validators.required],
    serial_number: ['', Validators.required],
    daily_working_hours: this.fb.control<number | null>(8, [
      Validators.required,
      Validators.min(0),
    ]),
    current_hour_meter: this.fb.control<number | null>(null),
    location: ['', Validators.required],
    status: this.fb.nonNullable.control<string>('ACTIVE'),
  });

  readonly statusOptions: { value: MachineStatus; label: string }[] = [
    { value: 'ACTIVE', label: 'Activa' },
    { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
    { value: 'DECOMMISSIONED', label: 'Dada de baja' },
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

  plateDisplaySrc(): string | null {
    return this.platePreviewSrc() || this.existingPlateUrl();
  }

  private loadLookups(): void {
    forkJoin({
      clients: this.clientsApi.listForCompany(),
      brands: this.http.get<Record<string, unknown>[]>(`${environment.apiUrl}/brands/`),
    }).subscribe({
      next: ({ clients, brands }) => {
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
      },
      error: () => {
        this.errorMessage.set('No se pudieron cargar clientes o marcas.');
      },
    });
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
      this.errorMessage.set('La placa debe ser una imagen (PNG, JPG, etc.).');
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

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
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
    this.resetPlateState(null);
    this.form.reset({
      id: null,
      client: null,
      brand: null,
      model: '',
      serial_number: '',
      daily_working_hours: 8,
      current_hour_meter: null,
      location: '',
      status: 'ACTIVE',
    });
    this.syncPickerLabels(null, null);
    this.modalOpen.set(true);
  }

  openEdit(row: Machine): void {
    this.editingId.set(row.id);
    this.resetPlateState(row.plate_image_url);
    this.form.patchValue({
      id: row.id,
      client: row.client || null,
      brand: row.brand || null,
      model: row.model,
      serial_number: row.serial_number,
      daily_working_hours: row.daily_working_hours,
      current_hour_meter: row.current_hour_meter,
      location: row.location,
      status: row.status || 'ACTIVE',
    });
    this.syncPickerLabels(row.client || null, row.brand || null);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
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
    const payload: MachineWritePayload = {
      client: v.client,
      brand: v.brand,
      model: v.model.trim(),
      serial_number: v.serial_number.trim(),
      daily_working_hours: v.daily_working_hours,
      current_hour_meter: this.nullIfDecimal(v.current_hour_meter),
      location: v.location.trim(),
      status: v.status?.trim() || 'ACTIVE',
    };
    const id = this.editingId();
    const plateFile = this.pendingPlateFile;
    this.saving.set(true);
    this.errorMessage.set(null);
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
        this.errorMessage.set(this.formatError(err));
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
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.formatError(err)),
    });
  }

  private nullIfDecimal(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    const t = String(v).trim();
    if (t === '') return null;
    const n = Number(t.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string' && d.trim()) return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof (d as { detail: unknown }).detail === 'string') {
          return (d as { detail: string }).detail;
        }
        const parts: string[] = [];
        for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
          if (Array.isArray(v)) parts.push(`${k}: ${v.join(', ')}`);
          else if (typeof v === 'string') parts.push(`${k}: ${v}`);
        }
        if (parts.length) return parts.join(' · ');
      }
      return err.message || `Error ${err.status}`;
    }
    return 'Error desconocido';
  }
}
