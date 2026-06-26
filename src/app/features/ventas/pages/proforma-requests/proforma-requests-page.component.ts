import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { AuthService } from '../../../../core/services/auth.service';
import type {
  AssignableUser,
  ClientCreatePayload,
  ClientContactPatchPayload,
  ClientContactRow,
  ClientLookupContactItem,
  ClientLookupSalesSummary,
  ClientRow,
  ProformaEntryChannel,
  ProformaRequestRow,
  ProformaRequestStatus,
  ProformaRequestType,
} from '../../models/ventas.models';
import { ClientContactService } from '../../services/client-contact.service';
import { ClientService } from '../../services/client.service';
import { ProformaRequestService } from '../../services/proforma-request.service';
import { contactAdvisorAssignBody } from '../../utils/client-contact-body.utils';
import { coerceUserPk } from '../../utils/user-pk.utils';

const PICKER_PAGE = 100;

const ENTRY_CHANNELS: ProformaEntryChannel[] = [
  'META',
  'GOOGLE_ADS',
  'WHATSAPP',
  'EMAIL',
];

const PROFORMA_TYPES_LIST: ProformaRequestType[] = [
  'MAQUINARIA',
  'REPUESTOS',
  'SERVICIOS',
  'ALQUILERES',
];

const PROFORMA_STATUS_LIST: ProformaRequestStatus[] = [
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'SIN_RESPUESTA',
];

/** Filtro por vínculo con cotización en el listado. */
type ProformaQuotationLinkFilter = 'ALL' | 'PENDING' | 'QUOTED';

@Component({
  selector: 'app-proforma-requests-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './proforma-requests-page.component.html',
})
export class ProformaRequestsPageComponent implements OnInit {
  private readonly api = inject(ProformaRequestService);
  private readonly clientsApi = inject(ClientService);
  private readonly contactsApi = inject(ClientContactService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  readonly items = signal<ProformaRequestRow[]>([]);

  /** Búsqueda en listado (cliente, asesor, descripción, correlativo, etc.). */
  readonly listSearchQuery = signal('');
  /** null = todos los asignados. */
  readonly filterAssignedUserId = signal<number | null>(null);
  readonly filterEntryChannel = signal<'ALL' | ProformaEntryChannel>('ALL');
  readonly filterProformaType = signal<'ALL' | ProformaRequestType>('ALL');
  readonly filterStatus = signal<'ALL' | ProformaRequestStatus>('ALL');
  readonly filterQuotationLink = signal<ProformaQuotationLinkFilter>('ALL');

  readonly filteredItems = computed(() => {
    let rows = this.items();
    const assignedId = this.filterAssignedUserId();
    if (assignedId != null) rows = rows.filter((r) => this.rowAssignedUserPk(r) === assignedId);
    const ch = this.filterEntryChannel();
    if (ch !== 'ALL') rows = rows.filter((r) => r.entry_channel === ch);
    const tp = this.filterProformaType();
    if (tp !== 'ALL') rows = rows.filter((r) => r.proforma_type === tp);
    const st = this.filterStatus();
    if (st !== 'ALL') rows = rows.filter((r) => this.rowStatus(r) === st);
    const ql = this.filterQuotationLink();
    if (ql === 'PENDING') rows = rows.filter((r) => r.quotation == null);
    else if (ql === 'QUOTED') rows = rows.filter((r) => r.quotation != null);
    const raw = this.listSearchQuery().trim();
    if (raw) {
      rows = rows.filter((r) => {
        const haystack = [
          String(r.id),
          this.clientDisplayName(r),
          r.client_detail?.ruc ?? '',
          this.assignedDisplayName(r),
          r.assigned_user_detail?.username ?? '',
          r.assigned_user_detail?.nombre ?? '',
          this.channelLabel(r.entry_channel),
          this.typeLabel(r.proforma_type),
          this.statusLabel(this.rowStatus(r)),
          r.description,
          r.quotation_correlativo ?? '',
          r.quotation != null ? String(r.quotation) : '',
          this.formatStamp(r.entered_at),
          this.formatStamp(r.quoted_at),
        ].join(' ');
        return textMatchesLooseQuery(haystack, raw);
      });
    }
    return rows;
  });

  /** Usuarios asignados que aparecen en el listado cargado. */
  readonly assignedUserFilterOptions = computed(() => {
    const rows = this.items();
    const ids = [...new Set(rows.map((r) => this.rowAssignedUserPk(r)))].filter((id) => id > 0);
    const labelById = new Map<number, string>();
    for (const r of rows) {
      const pk = this.rowAssignedUserPk(r);
      if (pk > 0 && !labelById.has(pk)) {
        labelById.set(pk, this.assignedDisplayName(r));
      }
    }
    ids.sort((a, b) =>
      (labelById.get(a) ?? '').localeCompare(labelById.get(b) ?? '', 'es', { sensitivity: 'base' }),
    );
    return ids.map((id) => ({ id, label: labelById.get(id) ?? `Usuario #${id}` }));
  });

  readonly hasActiveListFilters = computed(
    () =>
      this.listSearchQuery().trim() !== '' ||
      this.filterAssignedUserId() != null ||
      this.filterEntryChannel() !== 'ALL' ||
      this.filterProformaType() !== 'ALL' ||
      this.filterStatus() !== 'ALL' ||
      this.filterQuotationLink() !== 'ALL',
  );

  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  readonly totalCount = computed(() => this.filteredItems().length);
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
  /** Vista dentro del modal: formulario proforma o alta de cliente. */
  readonly modalView = signal<'proforma' | 'newClient'>('proforma');
  readonly editingId = signal<number | null>(null);

  readonly clients = signal<ClientRow[]>([]);
  readonly clientsLoading = signal(false);
  readonly clientPickerOpen = signal(false);
  readonly clientSearchQuery = signal('');

  readonly assignableUsers = signal<AssignableUser[]>([]);
  readonly assignableLoading = signal(false);

  readonly contactsForClient = signal<ClientContactRow[]>([]);
  readonly contactsLoading = signal(false);
  /** Resumen comercial del cliente seleccionado (`GET /clients/lookup-by-ruc/`). */
  readonly clientSalesSummary = signal<ClientLookupSalesSummary | null>(null);
  readonly clientSalesSummaryLoading = signal(false);
  readonly contactSaving = signal(false);
  readonly consultingRucNewClient = signal(false);
  /** Cliente ya existente en empresa tras consultar RUC (no crear duplicado). */
  readonly existingClientFromDb = signal<ClientRow | null>(null);
  /** Contactos devueltos por lookup-by-ruc al consultar RUC en alta de cliente. */
  readonly existingClientLookupContacts = signal<ClientLookupContactItem[]>([]);
  /** Texto bajo el RUC cuando ya existe en BD (asesores por contactos). */
  readonly rucAdvisorHint = signal<string | null>(null);

  readonly ENTRY_CHANNELS = ENTRY_CHANNELS;
  readonly PROFORMA_TYPES_LIST = PROFORMA_TYPES_LIST;
  readonly PROFORMA_STATUS_LIST = PROFORMA_STATUS_LIST;

  readonly hasCompanyProfile = computed(() => this.auth.me()?.profile != null);

  /** Fila actual en edición (para campos solo lectura como fechas). */
  readonly editingRow = computed(() => {
    const id = this.editingId();
    if (id == null) return null;
    return this.items().find((r) => r.id === id) ?? null;
  });

  readonly myUserId = computed(() => this.auth.me()?.user?.id ?? null);

  readonly filteredClients = computed(() => {
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

  readonly form = this.fb.nonNullable.group({
    client: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    assigned_user: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    entry_channel: this.fb.nonNullable.control<ProformaEntryChannel>('WHATSAPP', Validators.required),
    proforma_type: this.fb.nonNullable.control<ProformaRequestType>('MAQUINARIA', Validators.required),
    status: this.fb.nonNullable.control<ProformaRequestStatus>('PENDIENTE', Validators.required),
    description: ['', Validators.required],
    unlink_quotation: [false],
  });

  readonly newClientForm = this.fb.nonNullable.group({
    ruc: ['', Validators.required],
    name: ['', Validators.required],
    contact_first_name: ['', Validators.required],
    contact_last_name: ['', Validators.required],
    email: [''],
    phone: [''],
  });

  readonly newContactForm = this.fb.nonNullable.group({
    contact_first_name: ['', Validators.required],
    contact_last_name: ['', Validators.required],
    email: [''],
    phone: [''],
  });

  ngOnInit(): void {
    this.reload();
    this.form.controls.client.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cid) => {
        if (cid > 0) this.loadClientContextById(cid);
        else this.clearClientContext();
      });

    this.newClientForm.controls.ruc.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.existingClientFromDb.set(null);
        this.rucAdvisorHint.set(null);
      });

  }

  /**
   * No usar `computed()` leyendo `FormControl.value`: no es signal y el valor puede quedar congelado
   * (p. ej. cliente seleccionado pero botón Guardar sigue deshabilitado).
   */
  canSubmitProforma(): boolean {
    const cid = this.form.controls.client.value;
    return cid > 0 && this.contactsForClient().length > 0;
  }

  channelLabel(c: ProformaEntryChannel): string {
    const labels: Record<ProformaEntryChannel, string> = {
      META: 'Meta',
      GOOGLE_ADS: 'Google Ads',
      WHATSAPP: 'WhatsApp',
      EMAIL: 'Email',
    };
    return labels[c];
  }

  typeLabel(t: ProformaRequestType): string {
    const labels: Record<ProformaRequestType, string> = {
      MAQUINARIA: 'Maquinaria',
      REPUESTOS: 'Repuestos',
      SERVICIOS: 'Servicios',
      ALQUILERES: 'Alquileres',
    };
    return labels[t];
  }

  /** Estado efectivo (registros antiguos sin campo en API). */
  rowStatus(row: ProformaRequestRow): ProformaRequestStatus {
    return row.status ?? 'PENDIENTE';
  }

  statusLabel(s: ProformaRequestStatus): string {
    const labels: Record<ProformaRequestStatus, string> = {
      PENDIENTE: 'Pendiente',
      APROBADA: 'Aprobada',
      RECHAZADA: 'Rechazada',
      SIN_RESPUESTA: 'Sin respuesta',
    };
    return labels[s];
  }

  statusBadgeClass(s: ProformaRequestStatus): string {
    const classes: Record<ProformaRequestStatus, string> = {
      PENDIENTE: 'badge-warning',
      APROBADA: 'badge-success',
      RECHAZADA: 'badge-error',
      SIN_RESPUESTA: 'badge-ghost border border-base-300',
    };
    return classes[s];
  }

  clientDisplayName(row: ProformaRequestRow): string {
    const d = row.client_detail;
    if (d?.name?.trim()) return d.name.trim();
    return `Cliente #${row.client}`;
  }

  assignedDisplayName(row: ProformaRequestRow): string {
    const d = row.assigned_user_detail;
    if (d?.nombre?.trim()) return d.nombre.trim();
    const full = [d?.first_name, d?.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
    if (d?.username) return d.username;
    return `Usuario #${row.assigned_user}`;
  }

  truncate(text: string, max = 80): string {
    const t = text?.trim() ?? '';
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
  }

  /** Fecha/hora ISO del backend para columnas `entered_at` / `quoted_at`. */
  formatStamp(iso: string | null | undefined): string {
    if (iso == null || iso === '') return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }

  canEdit(row: ProformaRequestRow): boolean {
    if (this.auth.isAdmin()) return true;
    if (this.auth.me()?.user?.is_superuser === true) return true;
    const me = this.myUserId();
    return me != null && row.assigned_user === me;
  }

  onListSearchInput(ev: Event): void {
    this.listSearchQuery.set((ev.target as HTMLInputElement).value);
    this.resetListPagingAfterFilter();
  }

  onFilterAssignedUserChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterAssignedUserId.set(v === '' ? null : Number(v));
    this.resetListPagingAfterFilter();
  }

  /** Select nativo «Derivar a»: el valor se guarda en el formulario como id numérico. */
  onDerivarAsesorChange(ev: Event): void {
    const pk = coerceUserPk((ev.target as HTMLSelectElement).value);
    this.form.patchValue({ assigned_user: pk ?? 0 });
    this.form.controls.assigned_user.markAsTouched();
  }

  onFilterEntryChannelChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterEntryChannel.set(v === 'ALL' ? 'ALL' : (v as ProformaEntryChannel));
    this.resetListPagingAfterFilter();
  }

  onFilterProformaTypeChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterProformaType.set(v === 'ALL' ? 'ALL' : (v as ProformaRequestType));
    this.resetListPagingAfterFilter();
  }

  onFilterStatusChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterStatus.set(v === 'ALL' ? 'ALL' : (v as ProformaRequestStatus));
    this.resetListPagingAfterFilter();
  }

  onFilterQuotationLinkChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterQuotationLink.set(v as ProformaQuotationLinkFilter);
    this.resetListPagingAfterFilter();
  }

  clearListFilters(): void {
    this.listSearchQuery.set('');
    this.filterAssignedUserId.set(null);
    this.filterEntryChannel.set('ALL');
    this.filterProformaType.set('ALL');
    this.filterStatus.set('ALL');
    this.filterQuotationLink.set('ALL');
    this.resetListPagingAfterFilter();
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

  private resetListPagingAfterFilter(): void {
    this.pageIndex.set(0);
    this.clampPageIndex();
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

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.items.set([...rows].sort((a, b) => b.id - a.id));
        this.clampPageIndex();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  ensureClientsLoaded(done?: () => void): void {
    if (this.clients().length > 0) {
      done?.();
      return;
    }
    this.clientsLoading.set(true);
    this.clientsApi.listForCompany().subscribe({
      next: (rows) => {
        this.clients.set([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        this.clientsLoading.set(false);
        done?.();
      },
      error: (err) => {
        this.clientsLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  loadAssignableUsers(done?: () => void): void {
    this.assignableLoading.set(true);
    this.api.assignableUsers().subscribe({
      next: (users) => {
        const normalized = users
          .map((u) => this.normalizeAssignableUser(u))
          .filter((u): u is AssignableUser => u != null);
        this.assignableUsers.set(
          normalized.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
        );
        this.coerceAssignedUserControlValue();
        this.syncAssignedUserSelectToAssignableList();
        this.assignableLoading.set(false);
        done?.();
      },
      error: (err) => {
        this.assignableLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  openNew(): void {
    if (!this.hasCompanyProfile()) return;
    this.editingId.set(null);
    this.modalView.set('proforma');
    this.form.reset(
      {
        client: 0,
        assigned_user: 0,
        entry_channel: 'WHATSAPP',
        proforma_type: 'MAQUINARIA',
        status: 'PENDIENTE',
        description: '',
        unlink_quotation: false,
      },
      { emitEvent: false },
    );
    this.clientSearchQuery.set('');
    this.clientPickerOpen.set(false);
    this.clearClientContext();
    this.modalOpen.set(true);
    this.ensureClientsLoaded();
    this.loadAssignableUsers();
  }

  openEdit(row: ProformaRequestRow): void {
    if (!this.canEdit(row)) return;
    this.editingId.set(row.id);
    this.modalView.set('proforma');
    this.form.patchValue({
      client: row.client,
      assigned_user: this.rowAssignedUserPk(row) || 0,
      entry_channel: row.entry_channel,
      proforma_type: row.proforma_type,
      status: this.rowStatus(row),
      description: row.description,
      unlink_quotation: false,
    });
    this.clientSearchQuery.set(this.clientDisplayName(row));
    this.clientPickerOpen.set(false);
    this.modalOpen.set(true);
    this.ensureClientsLoaded();
    this.loadAssignableUsers();
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.clearNewClientRucLookup();
    this.consultingRucNewClient.set(false);
  }

  switchToNewClient(): void {
    this.clearNewClientRucLookup();
    this.consultingRucNewClient.set(false);
    this.newClientForm.reset({
      ruc: '',
      name: '',
      contact_first_name: '',
      contact_last_name: '',
      email: '',
      phone: '',
    });
    this.modalView.set('newClient');
    if (!this.hasSelectedAssignedUser()) {
      this.form.patchValue({ assigned_user: 0 }, { emitEvent: false });
    }
    this.loadAssignableUsers();
  }

  hasSelectedAssignedUser(): boolean {
    return this.selectedAssignedUserPk() != null;
  }

  /** True si el asesor elegido ya tiene un contacto en el cliente encontrado por RUC. */
  canUseExistingClientFromLookup(): boolean {
    const sel = this.selectedAssignableUser();
    if (sel == null) return false;
    return this.lookupHasContactForAdvisor(sel);
  }

  assignedAdvisorNombre(): string | null {
    return this.selectedAssignableUser()?.nombre ?? null;
  }

  private selectedAssignableUser(): AssignableUser | null {
    const id = this.selectedAssignedUserPk();
    if (id == null) return null;
    return this.assignableUsers().find((u) => u.id === id) ?? null;
  }

  private contactAssignBodyForAdvisor(
    sel: AssignableUser,
  ): Pick<ClientContactPatchPayload, 'user' | 'owner'> {
    return contactAdvisorAssignBody(sel.id, sel.profileId);
  }

  backToProformaForm(): void {
    this.modalView.set('proforma');
  }

  selectClient(c: ClientRow): void {
    this.form.patchValue({ client: c.id });
    this.clientSearchQuery.set(c.name);
    this.clientPickerOpen.set(false);
  }

  clearClientSelection(): void {
    this.form.patchValue({ client: 0 });
    this.clientSearchQuery.set('');
    this.clearClientContext();
  }

  contactEncargadoLabel(ct: ClientContactRow): string | null {
    const nombre = ct.encargado?.nombre?.trim();
    if (nombre) return nombre;
    const u = ct.owner_user;
    if (u) {
      const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      return full || u.username || null;
    }
    const id = ct.user ?? ct.owner;
    return id != null ? `Usuario #${id}` : null;
  }

  private clearClientContext(): void {
    this.contactsForClient.set([]);
    this.clientSalesSummary.set(null);
    this.clientSalesSummaryLoading.set(false);
  }

  private loadClientContextById(clientId: number): void {
    const fromList = this.clients().find((c) => c.id === clientId);
    if (fromList) {
      this.loadClientContext(fromList);
      return;
    }
    this.clientsApi.retrieve(clientId).subscribe({
      next: (row) => {
        this.clients.update((prev) => {
          if (prev.some((c) => c.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => a.name.localeCompare(b.name));
        });
        this.loadClientContext(row);
      },
      error: (err) => {
        this.clearClientContext();
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private loadClientContext(client: ClientRow): void {
    this.loadContactsForSelectedClient(client.id);
    this.loadClientSalesSummary(client);
  }

  private loadClientSalesSummary(client: ClientRow): void {
    const ruc = client.ruc?.trim();
    if (!ruc) {
      this.clientSalesSummary.set(null);
      this.clientSalesSummaryLoading.set(false);
      return;
    }
    this.clientSalesSummaryLoading.set(true);
    this.clientSalesSummary.set(null);
    this.clientsApi.lookupByRuc(ruc, 'company').subscribe({
      next: (res) => {
        this.clientSalesSummary.set(res.sales_summary);
        this.clientSalesSummaryLoading.set(false);
      },
      error: () => {
        this.clientSalesSummary.set(null);
        this.clientSalesSummaryLoading.set(false);
      },
    });
  }

  onClientSearchInput(ev: Event): void {
    this.clientSearchQuery.set((ev.target as HTMLInputElement).value);
    this.clientPickerOpen.set(true);
  }

  closeClientPickerSoon(): void {
    setTimeout(() => this.clientPickerOpen.set(false), 180);
  }

  loadContactsForSelectedClient(clientId: number): void {
    if (!clientId) {
      this.contactsForClient.set([]);
      return;
    }
    this.contactsLoading.set(true);
    this.contactsApi.listForClient(clientId).subscribe({
      next: (rows) => {
        this.contactsForClient.set(rows.filter((r) => r.client === clientId));
        this.contactsLoading.set(false);
      },
      error: (err) => {
        this.contactsLoading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /** Buscar por RUC vía API core (`lookup-by-ruc`); si no existe en empresa, consultar SUNAT. */
  consultarRucNewClient(): void {
    const raw = this.newClientForm.controls.ruc.value?.trim() ?? '';
    if (!raw) {
      this.newClientForm.controls.ruc.markAsTouched();
      return;
    }
    this.consultingRucNewClient.set(true);
    this.errorMessage.set(null);
    this.rucAdvisorHint.set(null);
    this.existingClientFromDb.set(null);
    this.existingClientLookupContacts.set([]);

    this.clientsApi.lookupByRuc(raw, 'company').subscribe({
      next: (res) => {
        if (!res.exists || !res.client) {
          this.consultRucSunatForNewClient(raw);
          return;
        }
        const hit = res.client;
        this.clients.update((prev) => {
          if (prev.some((c) => c.id === hit.id)) return prev;
          return [...prev, hit].sort((a, b) => a.name.localeCompare(b.name));
        });
        this.existingClientFromDb.set(hit);
        this.existingClientLookupContacts.set(res.contacts ?? []);
        this.newClientForm.patchValue({ ruc: hit.ruc, name: hit.name }, { emitEvent: false });
        const hint =
          res.sales_summary?.message_for_ui?.trim() ||
          'Cliente ya registrado en su empresa. Puede usar el cliente existente o registrar un contacto nuevo.';
        this.rucAdvisorHint.set(hint);
        this.consultingRucNewClient.set(false);
      },
      error: (err) => {
        this.consultingRucNewClient.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /** Selecciona el cliente encontrado y vuelve al formulario de solicitud (puede agregar otro contacto después). */
  useExistingClientFromLookup(): void {
    const hit = this.existingClientFromDb();
    if (!hit) return;
    const sel = this.selectedAssignableUser();
    if (sel != null && !this.lookupHasContactForAdvisor(sel)) {
      this.errorMessage.set(
        `Para derivar a ${sel.nombre}, registre un contacto con «Registrar contacto y volver». ` +
          `«Usar cliente existente» mantiene los contactos actuales (otro asesor).`,
      );
      return;
    }
    this.clearNewClientRucLookup();
    this.selectClient(hit);
    this.backToProformaForm();
  }

  /**
   * Crea un contacto nuevo para el cliente ya existente y vuelve al formulario de solicitud.
   * El encargado será «Derivar a» si está elegido.
   */
  registerContactForExistingLookupClient(): void {
    const hit = this.existingClientFromDb();
    if (!hit) return;
    this.coerceAssignedUserControlValue();
    const sel = this.requireAssignableUserOrError();
    if (sel == null) return;
    const cf = this.newClientForm.controls;
    if (cf.contact_first_name.invalid || cf.contact_last_name.invalid) {
      this.newClientForm.markAllAsTouched();
      return;
    }
    const v = this.newClientForm.getRawValue();
    const fn = v.contact_first_name.trim();
    const ln = v.contact_last_name.trim();
    this.contactSaving.set(true);
    this.errorMessage.set(null);

    this.contactsApi.listForClient(hit.id).subscribe({
      next: (existingContacts) => {
        const dup = this.findDuplicateContactRow(existingContacts, fn, ln);
        const submit = (): void => {
          this.contactsApi
            .create({
              client: hit.id,
              contact_first_name: fn,
              contact_last_name: ln,
              ...(v.email.trim() ? { email: v.email.trim() } : {}),
              ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
              ...this.contactAssignBodyForAdvisor(sel),
            })
            .subscribe({
              next: () => {
                this.contactSaving.set(false);
                this.clearNewClientRucLookup();
                this.newClientForm.reset({
                  ruc: '',
                  name: '',
                  contact_first_name: '',
                  contact_last_name: '',
                  email: '',
                  phone: '',
                });
                this.form.patchValue({ client: hit.id, assigned_user: sel.id });
                this.clientSearchQuery.set(hit.name);
                this.clientPickerOpen.set(false);
                this.backToProformaForm();
                this.loadContactsForSelectedClient(hit.id);
              },
              error: (err) => {
                this.contactSaving.set(false);
                this.errorMessage.set(this.fmt(err));
              },
            });
        };

        if (dup) {
          const dupLabel = [dup.contact_first_name, dup.contact_last_name].filter(Boolean).join(' ').trim();
          if (
            !window.confirm(
              `Ya existe un contacto con el mismo nombre (#${dup.id}: «${dupLabel}»). ¿Crear otro igual?`,
            )
          ) {
            this.contactSaving.set(false);
            return;
          }
        }
        submit();
      },
      error: (err) => {
        this.contactSaving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private consultRucSunatForNewClient(ruc: string): void {
    this.clientsApi.consultRucIdentificacion(ruc).subscribe({
      next: (data) => {
        this.consultingRucNewClient.set(false);
        this.newClientForm.patchValue({ ruc: data.ruc, name: data.razon_social }, { emitEvent: false });
      },
      error: (err) => {
        this.consultingRucNewClient.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private clearNewClientRucLookup(): void {
    this.existingClientFromDb.set(null);
    this.existingClientLookupContacts.set([]);
    this.rucAdvisorHint.set(null);
  }

  saveNewClient(): void {
    this.coerceAssignedUserControlValue();
    const sel = this.requireAssignableUserOrError();
    if (sel == null) return;
    if (this.newClientForm.invalid) {
      this.newClientForm.markAllAsTouched();
      return;
    }
    if (this.existingClientFromDb()) {
      this.errorMessage.set(
        'Este RUC ya existe en su empresa. Use «Usar cliente existente» o «Registrar contacto y volver».',
      );
      return;
    }
    const v = this.newClientForm.getRawValue();
    const payload: ClientCreatePayload = {
      ruc: v.ruc.trim(),
      name: v.name.trim(),
      contact: {
        contact_first_name: v.contact_first_name.trim(),
        contact_last_name: v.contact_last_name.trim(),
        ...(v.email.trim() ? { email: v.email.trim() } : {}),
        ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
      },
    };
    this.saving.set(true);
    this.errorMessage.set(null);
    this.clientsApi.create(payload).subscribe({
      next: (created) => {
        this.assignAdvisorToInitialContact(created.id, sel, () => {
          this.saving.set(false);
          this.clearNewClientRucLookup();
          this.clients.update((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
          this.form.patchValue({
            client: created.id,
            assigned_user: sel.id,
          });
          this.clientSearchQuery.set(created.name);
          this.modalView.set('proforma');
          this.loadContactsForSelectedClient(created.id);
        });
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /**
   * POST /clients/ no admite asignar vendedor en el contacto anidado; se hace después vía client-contacts.
   */
  private assignAdvisorToInitialContact(
    clientId: number,
    advisor: AssignableUser,
    done: () => void,
  ): void {
    const assignBody = this.contactAssignBodyForAdvisor(advisor);
    const targetUserId = advisor.id;
    const targetProfileId = advisor.profileId;

    const patchContact = (contact: ClientContactRow): void => {
      this.contactsApi.patch(contact.id, assignBody).subscribe({
        next: () => {
          this.loadContactsForSelectedClient(clientId);
          done();
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(
            `Cliente creado (#${clientId}), pero no se pudo asignar al asesor: ${this.fmt(err)}`,
          );
        },
      });
    };

    const contactAssignedToAdvisor = (contact: ClientContactRow): boolean => {
      const candidates: unknown[] = [
        contact.user,
        contact.owner,
        contact.owner_user?.id,
        contact.encargado?.id,
      ];
      return candidates.some((value) => {
        const pk = coerceUserPk(value);
        if (pk == null) return false;
        if (pk === targetUserId) return true;
        return targetProfileId != null && pk === targetProfileId;
      });
    };

    const tryLoadContacts = (attempt: number): void => {
      this.contactsApi.listForClient(clientId).subscribe({
        next: (contacts) => {
          const contact = contacts.find((c) => c.client === clientId) ?? contacts[0];
          if (!contact) {
            if (attempt < 3) {
              window.setTimeout(() => tryLoadContacts(attempt + 1), 250);
              return;
            }
            this.saving.set(false);
            this.errorMessage.set(
              `Cliente creado (#${clientId}), pero no se encontró el contacto para asignar al asesor. Actualice la página o asigne el encargado en Contactos.`,
            );
            return;
          }

          if (contactAssignedToAdvisor(contact)) {
            done();
            return;
          }

          const sessionUserId = this.myUserId();
          const contactOwnerPk =
            coerceUserPk(contact.user) ??
            coerceUserPk(contact.owner) ??
            coerceUserPk(contact.owner_user?.id);
          if (
            sessionUserId != null &&
            targetUserId !== sessionUserId &&
            contactOwnerPk === sessionUserId
          ) {
            patchContact(contact);
            return;
          }

          patchContact(contact);
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(
            `Cliente creado (#${clientId}), pero no se pudo vincular el contacto: ${this.fmt(err)}`,
          );
        },
      });
    };

    tryLoadContacts(0);
  }

  saveNewContact(): void {
    const clientId = this.form.controls.client.value;
    if (!clientId) return;
    if (this.newContactForm.invalid) {
      this.newContactForm.markAllAsTouched();
      return;
    }
    const v = this.newContactForm.getRawValue();
    const fn = v.contact_first_name.trim();
    const ln = v.contact_last_name.trim();
    const dup = this.findDuplicateContactRow(this.contactsForClient(), fn, ln);
    if (dup) {
      const dupLabel = [dup.contact_first_name, dup.contact_last_name].filter(Boolean).join(' ').trim();
      if (
        !window.confirm(
          `Ya existe un contacto en este cliente con el mismo nombre y apellidos (#${dup.id}: «${dupLabel}»). ¿Desea crear otro registro igual? (Normalmente es la misma persona con otro uso de mayúsculas.)`,
        )
      ) {
        return;
      }
    }

    this.coerceAssignedUserControlValue();
    const sel = this.requireAssignableUserOrError();
    if (sel == null) return;
    this.contactSaving.set(true);
    this.errorMessage.set(null);
    this.contactsApi
      .create({
        client: clientId,
        contact_first_name: fn,
        contact_last_name: ln,
        ...(v.email.trim() ? { email: v.email.trim() } : {}),
        ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
        ...this.contactAssignBodyForAdvisor(sel),
      })
      .subscribe({
        next: () => {
          this.contactSaving.set(false);
          this.newContactForm.reset({
            contact_first_name: '',
            contact_last_name: '',
            email: '',
            phone: '',
          });
          this.loadClientContextById(clientId);
        },
        error: (err) => {
          this.contactSaving.set(false);
          this.errorMessage.set(this.fmt(err));
        },
      });
  }

  saveProforma(): void {
    if (!this.canSubmitProforma()) {
      this.form.markAllAsTouched();
      return;
    }
    const id = this.editingId();
    const v = this.form.getRawValue();
    this.coerceAssignedUserControlValue();
    const sel = this.requireAssignableUserOrError();
    if (sel == null) return;
    const assignedPk = sel.id;

    if (id == null) {
      if (this.form.invalid) {
        this.form.markAllAsTouched();
        return;
      }
      this.saving.set(true);
      this.errorMessage.set(null);
      this.api
        .create({
          client: v.client,
          assigned_user: assignedPk,
          entry_channel: v.entry_channel,
          proforma_type: v.proforma_type,
          status: v.status,
          description: v.description.trim(),
        })
        .subscribe({
          next: (row) => {
            if (row.assigned_user !== assignedPk) {
              this.saving.set(false);
              this.errorMessage.set(
                `La solicitud se creó, pero el asesor asignado en el servidor (#${row.assigned_user}) no coincide con «${sel.nombre}» (#${assignedPk}). Revise con soporte o reasigne editando la solicitud.`,
              );
              this.reload();
              return;
            }
            this.afterSaveOk();
          },
          error: (err) => this.onSaveErr(err),
        });
      return;
    }

    const patch: Record<string, unknown> = {
      client: v.client,
      assigned_user: assignedPk,
      entry_channel: v.entry_channel,
      proforma_type: v.proforma_type,
      status: v.status,
      description: v.description.trim(),
    };
    if (v.unlink_quotation) {
      patch['quotation'] = null;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.api.patch(id, patch).subscribe({
      next: () => this.afterSaveOk(),
      error: (err) => this.onSaveErr(err),
    });
  }

  unlinkQuotation(row: ProformaRequestRow): void {
    if (!this.canEdit(row) || row.quotation == null) return;
    if (!window.confirm('¿Desvincular la cotización de esta solicitud?')) return;
    this.errorMessage.set(null);
    this.api.patch(row.id, { quotation: null }).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  remove(row: ProformaRequestRow): void {
    if (!this.canEdit(row)) return;
    if (!window.confirm(`¿Eliminar la solicitud de proforma #${row.id}?`)) return;
    this.errorMessage.set(null);
    this.api.delete(row.id).subscribe({
      next: () => this.reload(),
      error: (err) => this.errorMessage.set(this.fmt(err)),
    });
  }

  goGenerateQuotation(row: ProformaRequestRow): void {
    void this.router.navigate(['/ventas/cotizaciones'], {
      queryParams: {
        proformaRequest: row.id,
        client: row.client,
        assignedUser: row.assigned_user,
      },
    });
  }

  goToQuotation(row: ProformaRequestRow): void {
    const qid = row.quotation;
    if (qid == null) return;
    void this.router.navigate(['/ventas/cotizaciones'], {
      queryParams: { cotizacion: qid },
    });
  }

  private afterSaveOk(): void {
    this.saving.set(false);
    this.modalOpen.set(false);
    this.reload();
  }

  private onSaveErr(err: unknown): void {
    this.saving.set(false);
    this.errorMessage.set(this.fmt(err));
  }

  /**
   * Detecta el mismo nombre/apellido con distinto casing (p. ej. "Oscar Jara" vs "oscar jara").
   * Solo aplica al alta de contacto en este cliente.
   */
  private findDuplicateContactRow(
    rows: ClientContactRow[],
    firstName: string,
    lastName: string,
  ): ClientContactRow | null {
    const a = firstName.trim().toLowerCase();
    const b = lastName.trim().toLowerCase();
    if (!a && !b) return null;
    return (
      rows.find(
        (r) =>
          r.contact_first_name.trim().toLowerCase() === a &&
          r.contact_last_name.trim().toLowerCase() === b,
      ) ?? null
    );
  }

  private lookupHasContactForAdvisor(advisor: AssignableUser): boolean {
    return this.existingClientLookupContacts().some((ct) => {
      const assignedId = coerceUserPk(ct.assigned_user?.id);
      return assignedId != null && assignedId === advisor.id;
    });
  }

  private userPkFromUnknown(value: unknown): number | null {
    return coerceUserPk(value);
  }

  /**
   * Mapea assignable-users: `id` = usuario Django (proforma); `profileId` = perfil para contactos.
   */
  private normalizeAssignableUser(raw: unknown): AssignableUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    let userId: number | null = null;
    let profileId: number | undefined;

    if (typeof r['user'] === 'number') {
      userId = coerceUserPk(r['user']);
      profileId = coerceUserPk(r['id']) ?? undefined;
    } else if (r['user'] != null && typeof r['user'] === 'object') {
      userId = coerceUserPk(r['user']);
      profileId = coerceUserPk(r['profile_id'] ?? r['profile'] ?? r['id']) ?? undefined;
    } else {
      userId = coerceUserPk(r['user_id'] ?? r['id']);
    }

    if (userId == null) return null;

    const src =
      r['user'] && typeof r['user'] === 'object'
        ? (r['user'] as Record<string, unknown>)
        : r;

    const nombre =
      (typeof r['nombre'] === 'string' && r['nombre'].trim()) ||
      (typeof src['nombre'] === 'string' && String(src['nombre']).trim()) ||
      [src['first_name'], src['last_name']].filter(Boolean).join(' ').trim() ||
      (typeof src['username'] === 'string' ? src['username'] : '') ||
      `Usuario #${userId}`;

    return {
      id: userId,
      profileId,
      username: String(src['username'] ?? ''),
      first_name: String(src['first_name'] ?? ''),
      last_name: String(src['last_name'] ?? ''),
      nombre,
    };
  }

  selectedAssignedUserPk(): number | null {
    return coerceUserPk(this.form.controls.assigned_user.value);
  }

  /** Tras cargar assignable-users, alinea el valor del select con el `id` del API. */
  private syncAssignedUserSelectToAssignableList(): void {
    const current = this.selectedAssignedUserPk();
    if (current == null) return;
    const match = this.assignableUsers().find((u) => u.id === current);
    if (match && match.id !== current) {
      this.form.patchValue({ assigned_user: match.id }, { emitEvent: false });
    }
  }

  private rowAssignedUserPk(row: ProformaRequestRow): number {
    return coerceUserPk(row.assigned_user) ?? 0;
  }

  /** Normaliza el control a id numérico (string del DOM u objeto User del API). */
  private coerceAssignedUserControlValue(): void {
    const raw = this.form.controls.assigned_user.value;
    const pk = coerceUserPk(raw);
    if (pk != null) {
      if (typeof raw !== 'number' || raw !== pk) {
        this.form.patchValue({ assigned_user: pk }, { emitEvent: false });
      }
    } else if (raw != null && typeof raw === 'object') {
      this.form.patchValue({ assigned_user: 0 }, { emitEvent: false });
    }
  }

  private requireAssignableUserOrError(): AssignableUser | null {
    this.coerceAssignedUserControlValue();
    const sel = this.selectedAssignableUser();
    if (sel == null) {
      this.form.controls.assigned_user.markAsTouched();
      this.errorMessage.set('Seleccione el asesor en «Derivar a».');
      return null;
    }
    return sel;
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof (d as { detail: string }).detail === 'string') {
          return (d as { detail: string }).detail;
        }
        const parts: string[] = [];
        for (const [k, val] of Object.entries(d)) {
          if (Array.isArray(val)) parts.push(`${k}: ${val.join(', ')}`);
          else if (val != null && typeof val === 'object')
            parts.push(`${k}: ${JSON.stringify(val)}`);
          else parts.push(`${k}: ${String(val)}`);
        }
        if (parts.length) return parts.join('. ');
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
