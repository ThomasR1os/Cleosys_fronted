import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Observable,
  catchError,
  concatMap,
  filter,
  forkJoin,
  from,
  map,
  of,
  Subscription,
  switchMap,
  tap,
  toArray,
} from 'rxjs';
import type { Product } from '../../../almacen/models/almacen.models';
import { ProductService } from '../../../almacen/services/product.service';
import { plainTextFromHtml } from '../../../../core/utils/html-text.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import { RichTextEditorComponent } from '../../../../shared/rich-text/rich-text-editor.component';
import { AuthService } from '../../../../core/services/auth.service';
import type { TaskSummary } from '../../../tareas/models/task.models';
import { TaskService } from '../../../tareas/services/task.service';
import type {
  AssignableUser,
  ClientCreatePayload,
  ClientContactPatchPayload,
  ClientContactRow,
  ClientLookupContactItem,
  ClientLookupSalesSummary,
  ClientRow,
  ProformaEntryChannel,
  ProformaPriority,
  ProformaRecommendation,
  ProformaRecommendationMatch,
  ProformaRequestAttachment,
  ProformaRequestItemPayload,
  RecommendationLineAvailability,
  ProformaRequestPatchPayload,
  ProformaRequestRow,
  ProformaRequestStatus,
  ProformaRequestType,
  ProformaWorkflowStatus,
  QuotationMoney,
  QuotationSummary,
  TaskQueue,
} from '../../models/ventas.models';
import { ProformaRequestDetailComponent } from './proforma-request-detail.component';
import {
  dueIsOverdue,
  effectiveWorkflow,
  isClosedWorkflow,
  isWaitingWorkflow,
  priorityLabel,
  queueLabel,
  requestCode,
  taskCode,
  waitingOnLabel,
  workflowBadgeClass,
  workflowLabel,
  WORKFLOW_STATUSES,
} from '../../utils/proforma-workflow.utils';
import { ClientContactService } from '../../services/client-contact.service';
import { ClientService } from '../../services/client.service';
import { ProformaRequestService } from '../../services/proforma-request.service';
import { QuotationService } from '../../services/quotation.service';
import {
  SaleApprovalService,
  type SaleApprovalContext,
  type SaleApprovalResult,
} from '../../services/sale-approval.service';
import { approvalChoicesError, soldItemsPayload, type ApprovalChoice } from '../../utils/sale-approval';
import { contactAdvisorAssignBody } from '../../utils/client-contact-body.utils';
import { SaleApprovalLinesComponent } from './sale-approval-lines.component';
import { coerceUserPk } from '../../utils/user-pk.utils';

const CLIENT_SEARCH_MIN = 2;

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

/** El editor vacío guarda `<p></p>`; exige texto visible. */
function richTextRequired(control: AbstractControl): ValidationErrors | null {
  return plainTextFromHtml(String(control.value ?? '')) ? null : { required: true };
}

const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

const ATTACHMENT_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.pdf,.xls,.xlsx,image/jpeg,image/png,image/webp,image/gif,application/pdf';

const ATTACHMENT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ATTACHMENT_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'xls', 'xlsx']);

interface PendingProformaFile {
  key: string;
  file: File;
  previewUrl: string | null;
}

function attachmentFileProblem(file: File): string | null {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name} supera 15 MB.`;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const typeKnown = file.type !== '' && file.type !== 'application/octet-stream';
  if (!ATTACHMENT_EXT.has(ext) || (typeKnown && !ATTACHMENT_MIME.has(file.type))) {
    return `${file.name} no es un tipo permitido. Use imagen, PDF o Excel.`;
  }
  return null;
}

type ListTab = 'all' | 'mine' | 'unassigned' | 'waiting' | 'done';

@Component({
  selector: 'app-proforma-requests-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    RichTextEditorComponent,
    ProformaRequestDetailComponent,
    SaleApprovalLinesComponent,
  ],
  templateUrl: './proforma-requests-page.component.html',
})
export class ProformaRequestsPageComponent implements OnInit {
  private readonly api = inject(ProformaRequestService);
  private readonly quotationsApi = inject(QuotationService);
  private readonly saleApproval = inject(SaleApprovalService);
  private readonly productsApi = inject(ProductService);
  private readonly clientsApi = inject(ClientService);
  private readonly contactsApi = inject(ClientContactService);
  private readonly tasksApi = inject(TaskService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  readonly items = signal<ProformaRequestRow[]>([]);
  readonly logisticsOrderByQuotation = signal<Record<number, number>>({});
  readonly approvalOpen = signal(false);
  readonly approvalProformaId = signal<number | null>(null);
  readonly approvalQuotationId = signal<number | null>(null);
  readonly approvalChoices = signal<ApprovalChoice[]>([]);
  readonly approvalContext = signal<SaleApprovalContext | null>(null);
  readonly approvalLoading = signal(false);
  readonly approvalBusy = signal(false);
  readonly approvalError = signal<string | null>(null);
  readonly approvalResult = signal<SaleApprovalResult | null>(null);

  /** Búsqueda en listado (cliente, asesor, descripción, correlativo, etc.). */
  readonly listSearchQuery = signal('');
  /** null = todos los asignados. */
  readonly filterAssignedUserId = signal<number | null>(null);
  readonly filterEntryChannel = signal<'ALL' | ProformaEntryChannel>('ALL');
  readonly filterProformaType = signal<'ALL' | ProformaRequestType>('ALL');
  readonly filterStatus = signal<'ALL' | ProformaRequestStatus>('ALL');
  readonly filterQuotationLink = signal<ProformaQuotationLinkFilter>('ALL');
  readonly filterWorkflow = signal<'ALL' | ProformaWorkflowStatus>('ALL');
  readonly filterQueue = signal<'ALL' | TaskQueue>('ALL');
  readonly filterPriority = signal<'ALL' | ProformaPriority>('ALL');
  readonly listTab = signal<ListTab>('all');
  readonly taskSummary = signal<TaskSummary | null>(null);
  readonly detailId = signal<number | null>(null);
  readonly PRIORITIES: ProformaPriority[] = ['LOW', 'NORMAL', 'HIGH'];
  readonly WORKFLOW_STATUSES = WORKFLOW_STATUSES;

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
    const wf = this.filterWorkflow();
    if (wf !== 'ALL') rows = rows.filter((r) => this.rowWorkflow(r) === wf);
    const qn = this.filterQueue();
    if (qn !== 'ALL') rows = rows.filter((r) => (r.task_queue ?? 'SALES') === qn);
    const pr = this.filterPriority();
    if (pr !== 'ALL') rows = rows.filter((r) => (r.priority ?? 'NORMAL') === pr);
    const ql = this.filterQuotationLink();
    if (ql === 'PENDING') rows = rows.filter((r) => r.quotation == null);
    else if (ql === 'QUOTED') rows = rows.filter((r) => r.quotation != null);
    const tab = this.listTab();
    const me = this.myUserId();
    if (tab === 'mine' && me != null) {
      rows = rows.filter((r) => this.rowAssignedUserPk(r) === me);
    } else if (tab === 'unassigned') {
      rows = rows.filter((r) => this.rowAssignedUserPk(r) <= 0);
    } else if (tab === 'waiting') {
      rows = rows.filter((r) => isWaitingWorkflow(this.rowWorkflow(r)));
    } else if (tab === 'done') {
      rows = rows.filter((r) => isClosedWorkflow(this.rowWorkflow(r)));
    }
    const raw = this.listSearchQuery().trim();
    if (raw) {
      rows = rows.filter((r) => {
        const haystack = [
          String(r.id),
          requestCode(r),
          taskCode(r) ?? '',
          this.clientDisplayName(r),
          r.client_detail?.ruc ?? '',
          this.assignedDisplayName(r),
          r.assigned_user_detail?.username ?? '',
          r.assigned_user_detail?.nombre ?? '',
          this.channelLabel(r.entry_channel),
          this.typeLabel(r.proforma_type),
          this.statusLabel(this.rowStatus(r)),
          workflowLabel(this.rowWorkflow(r)),
          queueLabel(r.task_queue),
          waitingOnLabel(r.waiting_on),
          plainTextFromHtml(r.description),
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

  readonly summaryCards = computed(() => {
    const api = this.taskSummary();
    if (api) {
      return {
        assignedToMe: api.assigned_to_me,
        waitingSupplier: api.waiting_supplier,
        pendingSales: api.pending_sales,
        overdue: api.overdue,
      };
    }
    const me = this.myUserId();
    const rows = this.items();
    return {
      assignedToMe: rows.filter((r) => me != null && this.rowAssignedUserPk(r) === me).length,
      waitingSupplier: rows.filter((r) => this.rowWorkflow(r) === 'WAITING_SUPPLIER').length,
      pendingSales: rows.filter((r) => {
        const wf = this.rowWorkflow(r);
        return wf === 'PENDING_SALES' || wf === 'PENDING_SALES_REVIEW' || wf === 'WAITING_SALES_INFORMATION';
      }).length,
      overdue: rows.filter((r) => dueIsOverdue(r.due_at, this.rowWorkflow(r))).length,
    };
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
      this.filterQuotationLink() !== 'ALL' ||
      this.filterWorkflow() !== 'ALL' ||
      this.filterQueue() !== 'ALL' ||
      this.filterPriority() !== 'ALL' ||
      this.listTab() !== 'all',
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
  readonly loadingMore = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** Cierre masivo de solicitudes históricas (solo admin). */
  readonly bulkCloseBusy = signal(false);
  readonly bulkCloseProgress = signal<{ done: number; total: number } | null>(null);
  readonly bulkCloseResult = signal<string | null>(null);
  /** Solicitudes ingresadas o cotizadas antes de esta fecha (hora local). */
  private readonly legacyCloseCutoff = new Date(2026, 9, 15);

  readonly modalOpen = signal(false);
  /** Vista dentro del modal: formulario proforma o alta de cliente. */
  readonly modalView = signal<'proforma' | 'newClient'>('proforma');
  readonly editingId = signal<number | null>(null);

  readonly clients = signal<ClientRow[]>([]);
  readonly clientSearchResults = signal<ClientRow[]>([]);
  readonly clientsLoading = signal(false);
  readonly clientPickerOpen = signal(false);
  readonly clientSearchQuery = signal('');
  private clientSearchTicket = 0;
  private clientSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private listSub: Subscription | null = null;

  readonly assignableUsers = signal<AssignableUser[]>([]);
  readonly assignableLoading = signal(false);

  readonly quotationSummaries = signal<QuotationSummary[]>([]);
  readonly quotationSummariesLoading = signal(false);
  readonly quotationSummariesError = signal<string | null>(null);
  private quotationSummaryTicket = 0;
  /** Cliente cuyas cotizaciones ya corresponden al valor del selector. */
  private quotationSummaryClientId: number | null = null;
  private listTicket = 0;

  readonly contactsForClient = signal<ClientContactRow[]>([]);
  readonly contactsLoading = signal(false);
  /** Resumen comercial del cliente seleccionado (`GET /clients/lookup-by-ruc/`). */
  readonly clientSalesSummary = signal<ClientLookupSalesSummary | null>(null);
  readonly clientSalesSummaryLoading = signal(false);
  readonly contactSaving = signal(false);
  readonly savedAttachments = signal<ProformaRequestAttachment[]>([]);
  readonly pendingFiles = signal<PendingProformaFile[]>([]);
  readonly attachmentsLoading = signal(false);
  readonly attachmentHint = signal<string | null>(null);
  readonly deletingAttachmentId = signal<number | null>(null);
  readonly attachmentAccept = ATTACHMENT_ACCEPT;

  readonly recommendOpen = signal(false);
  readonly recommendRequestId = signal<number | null>(null);
  readonly recommendPhase = signal<'loading' | 'result' | 'error'>('loading');
  readonly recommend = signal<ProformaRecommendation | null>(null);
  readonly recommendError = signal<string | null>(null);
  readonly createFlowRow = signal<ProformaRequestRow | null>(null);
  readonly createFlowStep = signal<'recommend' | 'manual'>('recommend');
  readonly selectedRecKeys = signal<string[]>([]);
  readonly manualPath = signal<'pick' | 'logistics' | null>(null);
  readonly catalogQuery = signal('');
  readonly catalogProducts = signal<Product[]>([]);
  readonly catalogLoading = signal(false);
  readonly pickedCatalog = signal<Product | null>(null);
  readonly logisticsUsers = signal<AssignableUser[]>([]);
  readonly logisticsUsersLoading = signal(false);
  readonly logisticsUserId = signal(0);
  readonly logisticsSending = signal(false);
  readonly logisticsError = signal<string | null>(null);
  /** Solicitud recién creada: al terminar el guardado se abre el flujo de recomendación. */
  private recommendPromptForId: number | null = null;
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
  readonly isLogisticsContext = computed(() => this.router.url.startsWith('/logistica'));
  readonly hubLink = computed(() => (this.isLogisticsContext() ? '/logistica' : '/ventas'));
  readonly hubLabel = computed(() => (this.isLogisticsContext() ? 'Logística' : 'Ventas'));

  readonly filteredClients = computed(() => this.clientSearchResults());
  readonly filteredCatalogProducts = computed(() => {
    const q = this.catalogQuery().trim();
    const all = this.catalogProducts();
    if (!q) return all.slice(0, 20);
    return all
      .filter(
        (p) =>
          textMatchesLooseQuery(`${p.sku} ${p.description}`, q) || String(p.id).includes(q),
      )
      .slice(0, 20);
  });
  readonly selectedRecommendationCount = computed(() => this.selectedRecKeys().length);

  readonly form = this.fb.nonNullable.group({
    client: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    assigned_user: this.fb.nonNullable.control<number>(0, [Validators.required, Validators.min(1)]),
    entry_channel: this.fb.nonNullable.control<ProformaEntryChannel>('WHATSAPP', Validators.required),
    proforma_type: this.fb.nonNullable.control<ProformaRequestType>('MAQUINARIA', Validators.required),
    status: this.fb.nonNullable.control<ProformaRequestStatus>('PENDIENTE', Validators.required),
    priority: this.fb.nonNullable.control<ProformaPriority>('NORMAL', Validators.required),
    due_at: [''],
    description: ['', richTextRequired],
    quotation: this.fb.nonNullable.control(0),
  });
  readonly requestItems = this.fb.array([this.buildRequestItemGroup()]);

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
    this.destroyRef.onDestroy(() => {
      this.clearPendingFiles();
      if (this.clientSearchTimer != null) clearTimeout(this.clientSearchTimer);
      this.listSub?.unsubscribe();
    });
    this.reload();
    this.loadTaskSummary();
    this.loadAssignableUsers();
    this.clientsApi.prefetchCompanyList().subscribe({
      next: (rows) => this.rememberClients(rows),
      error: () => undefined,
    });
    this.form.controls.client.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cid) => this.onClientChosen(cid));

    this.newClientForm.controls.ruc.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.existingClientFromDb.set(null);
        this.rucAdvisorHint.set(null);
      });

    const detalle = Number(this.route.snapshot.queryParamMap.get('detalle') ?? '');
    if (Number.isInteger(detalle) && detalle > 0) {
      this.detailId.set(detalle);
    }
  }

  rowWorkflow(row: ProformaRequestRow): ProformaWorkflowStatus {
    return effectiveWorkflow(row);
  }

  requestCode(row: ProformaRequestRow): string {
    return requestCode(row);
  }

  taskCode(row: ProformaRequestRow): string | null {
    return taskCode(row);
  }

  workflowLabel(status: ProformaWorkflowStatus | null | undefined): string {
    return workflowLabel(status);
  }

  workflowBadgeClass(status: ProformaWorkflowStatus | null | undefined): string {
    return workflowBadgeClass(status);
  }

  queueLabel(queue: TaskQueue | null | undefined): string {
    return queueLabel(queue);
  }

  waitingOnLabel(value: ProformaRequestRow['waiting_on']): string {
    return waitingOnLabel(value);
  }

  priorityLabel(value: ProformaPriority | null | undefined): string {
    return priorityLabel(value);
  }

  lastMoveStamp(row: ProformaRequestRow): string {
    return this.formatStamp(row.last_moved_at ?? row.updated_at ?? row.entered_at);
  }

  dueStamp(row: ProformaRequestRow): string {
    if (isClosedWorkflow(this.rowWorkflow(row))) return 'Completada';
    return this.formatStamp(row.due_at);
  }

  isOverdue(row: ProformaRequestRow): boolean {
    return dueIsOverdue(row.due_at, this.rowWorkflow(row));
  }

  setListTab(tab: ListTab): void {
    this.listTab.set(tab);
    this.resetListPagingAfterFilter();
  }

  openDetail(row: ProformaRequestRow): void {
    this.detailId.set(row.id);
  }

  closeDetail(): void {
    this.detailId.set(null);
  }

  onDetailChanged(): void {
    this.reload();
    this.loadTaskSummary();
  }

  requestItemGroup(index: number) {
    return this.requestItems.at(index);
  }

  addRequestItem(): void {
    this.requestItems.push(this.buildRequestItemGroup());
  }

  removeRequestItem(index: number): void {
    if (this.requestItems.length === 1) {
      this.requestItems.at(0).reset({ requested_sku: '', description: '', quantity: '1', requested_unit: 'UND' });
      return;
    }
    this.requestItems.removeAt(index);
  }

  private buildRequestItemGroup() {
    return this.fb.nonNullable.group({
      requested_sku: [''],
      description: [''],
      quantity: ['1'],
      requested_unit: ['UND'],
    });
  }

  private resetRequestItems(): void {
    this.requestItems.clear();
    this.requestItems.push(this.buildRequestItemGroup());
  }

  private requestItemsPayload(): ProformaRequestItemPayload[] {
    return this.requestItems.getRawValue()
      .map((item) => ({
        requested_sku: item.requested_sku.trim(),
        description: item.description.trim(),
        quantity: item.quantity.trim() || '1',
        requested_unit: item.requested_unit.trim() || 'UND',
      }))
      .filter((item) => item.description !== '');
  }

  private loadTaskSummary(): void {
    this.tasksApi.summary().subscribe({
      next: (summary) => this.taskSummary.set(summary),
      error: () => this.taskSummary.set(null),
    });
  }

  canBulkCloseLegacy(): boolean {
    if (this.auth.isAdmin() || this.auth.me()?.user?.is_superuser === true) return true;
    // Limpieza operativa del contador histórico; también ventas de la empresa.
    return this.auth.me()?.profile?.role === 'VENTAS';
  }

  /**
   * Cierre histórico en orden:
   * 1) con cotización y fecha anterior al 15/10 → complete-flow
   * 2) ya rechazadas / sin respuesta / anuladas operativas → complete-flow
   * Sin cotización y aún pendientes se dejan abiertas.
   */
  bulkCloseLegacyBeforeCutoff(): void {
    if (!this.canBulkCloseLegacy() || this.bulkCloseBusy()) return;
    const cutoffLabel = this.legacyCloseCutoff.toLocaleDateString('es-PE');
    if (
      !window.confirm(
        `Orden del cierre histórico (corte ${cutoffLabel}):\n\n` +
          '1. Solicitudes abiertas que YA tienen cotización y son anteriores al corte → se finalizan.\n' +
          '2. Las que ya están rechazadas, sin respuesta o no posibles → se cierra el flujo.\n' +
          '3. Sin cotización y aún pendientes → se dejan como están.\n\n' +
          '¿Continuar?',
      )
    ) {
      return;
    }
    this.bulkCloseBusy.set(true);
    this.bulkCloseProgress.set(null);
    this.bulkCloseResult.set(null);
    this.errorMessage.set(null);

    this.api
      .listIncremental({ maxPages: 200, pageSize: 25 })
      .pipe(filter((page) => page.done))
      .subscribe({
        next: (page) => {
          const withQuote = page.rows.filter((row) => this.shouldCloseLegacyWithQuotation(row));
          const abandoned = page.rows.filter(
            (row) =>
              !withQuote.some((q) => q.id === row.id) && this.shouldCloseLegacyAbandoned(row),
          );
          const targets = [...withQuote, ...abandoned];
          const skippedPending = page.rows.filter(
            (row) =>
              !isClosedWorkflow(this.rowWorkflow(row)) &&
              row.quotation == null &&
              this.rowStatus(row) === 'PENDIENTE',
          ).length;
          if (!targets.length) {
            this.bulkCloseBusy.set(false);
            this.bulkCloseResult.set(
              skippedPending > 0
                ? `No había nada que cerrar. Quedan ${skippedPending} pendiente(s) sin cotización.`
                : 'No había solicitudes abiertas para cerrar con ese criterio.',
            );
            this.loadTaskSummary();
            return;
          }
          this.bulkCloseProgress.set({ done: 0, total: targets.length });
          from(targets)
            .pipe(
              concatMap((row) => this.closeLegacyRow(row, cutoffLabel)),
              toArray(),
            )
            .subscribe({
              next: (results) => {
                const ok = results.filter((r) => r.ok).length;
                const fail = results.length - ok;
                const quotedOk = results.filter((r) => r.ok && r.kind === 'quoted').length;
                const abandonedOk = results.filter((r) => r.ok && r.kind === 'abandoned').length;
                this.bulkCloseBusy.set(false);
                this.bulkCloseProgress.set(null);
                const parts = [
                  `Con cotización: ${quotedOk}.`,
                  `Rechazadas / sin respuesta / no posibles: ${abandonedOk}.`,
                ];
                if (skippedPending > 0) {
                  parts.push(`Pendientes sin cotización (sin tocar): ${skippedPending}.`);
                }
                if (fail > 0) parts.push(`Fallaron ${fail}.`);
                this.bulkCloseResult.set(`Listo. ${parts.join(' ')}`);
                this.listTicket++;
                this.items.set([]);
                this.reload();
                this.loadTaskSummary();
              },
              error: (err) => {
                this.bulkCloseBusy.set(false);
                this.bulkCloseProgress.set(null);
                this.errorMessage.set(this.fmt(err));
              },
            });
        },
        error: (err) => {
          this.bulkCloseBusy.set(false);
          this.errorMessage.set(this.fmt(err));
        },
      });
  }

  /** Paso 1: abiertas, con cotización, anteriores al corte. */
  private shouldCloseLegacyWithQuotation(row: ProformaRequestRow): boolean {
    if (isClosedWorkflow(this.rowWorkflow(row))) return false;
    if (row.quotation == null) return false;
    return this.isBeforeLegacyCutoff(row);
  }

  /** Paso 2: ya no se procedió, pero el flujo operativo sigue abierto. */
  private shouldCloseLegacyAbandoned(row: ProformaRequestRow): boolean {
    if (isClosedWorkflow(this.rowWorkflow(row))) return false;
    const status = this.rowStatus(row);
    if (status === 'RECHAZADA' || status === 'SIN_RESPUESTA') return true;
    return this.rowWorkflow(row) === 'NOT_POSSIBLE';
  }

  private isBeforeLegacyCutoff(row: ProformaRequestRow): boolean {
    const stamp = row.quoted_at || row.entered_at || row.last_moved_at || row.updated_at;
    if (!stamp) return false;
    const d = new Date(stamp);
    return !Number.isNaN(d.getTime()) && d.getTime() < this.legacyCloseCutoff.getTime();
  }

  private closeLegacyRow(
    row: ProformaRequestRow,
    cutoffLabel: string,
  ): Observable<{ ok: boolean; id: number; kind: 'quoted' | 'abandoned' }> {
    const kind: 'quoted' | 'abandoned' = this.shouldCloseLegacyWithQuotation(row)
      ? 'quoted'
      : 'abandoned';
    return this.api.completeFlow(row.id).pipe(
      map(() => ({ ok: true as const, id: row.id, kind })),
      catchError(() =>
        this.api
          .markNotPossible(row.id, {
            reason: `Cierre histórico automático (antes del ${cutoffLabel})`,
          })
          .pipe(
            map(() => ({ ok: true as const, id: row.id, kind })),
            catchError(() => of({ ok: false as const, id: row.id, kind })),
          ),
      ),
      tap(() => {
        const prev = this.bulkCloseProgress();
        if (prev) this.bulkCloseProgress.set({ done: prev.done + 1, total: prev.total });
      }),
    );
  }

  /** Si el estado comercial indica que no se procedió, cierra el flujo operativo. */
  private closeFlowIfAbandoned(
    id: number,
    status: ProformaRequestStatus,
    onDone: () => void,
  ): void {
    if (status !== 'RECHAZADA' && status !== 'SIN_RESPUESTA') {
      onDone();
      return;
    }
    this.api.completeFlow(id).subscribe({
      next: () => onDone(),
      error: () => onDone(),
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

  formStatusOptions(): ProformaRequestStatus[] {
    if (this.form.controls.status.value === 'APROBADA') return ['APROBADA'];
    return PROFORMA_STATUS_LIST.filter((status) => status !== 'APROBADA');
  }

  canApproveProforma(row: ProformaRequestRow): boolean {
    return this.canEdit(row) && this.rowStatus(row) !== 'APROBADA' && row.quotation != null;
  }

  internalOrderId(row: ProformaRequestRow): number | null {
    if (this.rowStatus(row) !== 'APROBADA' || row.quotation == null) return null;
    if (row.logistics_order_id != null && row.logistics_order_id > 0) return row.logistics_order_id;
    return this.logisticsOrderByQuotation()[row.quotation] ?? null;
  }

  approvalProforma(): ProformaRequestRow | null {
    const id = this.approvalProformaId();
    if (id == null) return null;
    return this.items().find((row) => row.id === id) ?? null;
  }

  openApproval(row: ProformaRequestRow): void {
    if (!this.canApproveProforma(row) || row.quotation == null) return;
    this.approvalProformaId.set(row.id);
    this.approvalQuotationId.set(row.quotation);
    this.approvalChoices.set([]);
    this.approvalContext.set(null);
    this.approvalError.set(null);
    this.approvalResult.set(null);
    this.approvalLoading.set(true);
    this.approvalOpen.set(true);
    this.saleApproval.loadChoices(row.quotation, row.id).subscribe({
      next: (context) => {
        this.approvalContext.set(context);
        this.approvalChoices.set(context.choices);
        this.approvalLoading.set(false);
      },
      error: (err) => {
        this.approvalLoading.set(false);
        this.approvalError.set(this.fmt(err));
      },
    });
  }

  closeApproval(): void {
    if (this.approvalBusy()) return;
    this.approvalOpen.set(false);
  }

  approvalMoney(): QuotationMoney {
    return this.approvalContext()?.quotation.money ?? 'USD';
  }

  approvalBlocked(): boolean {
    return approvalChoicesError(this.approvalChoices()) != null;
  }

  onApprovalChoices(choices: ApprovalChoice[]): void {
    this.approvalChoices.set(choices);
  }

  stockSummary(lines: { sku: string; qty: number }[]): string {
    return lines.map((row) => `${row.sku} x ${row.qty}`).join(', ');
  }

  confirmApproval(): void {
    const proformaId = this.approvalProformaId();
    const quotationId = this.approvalQuotationId();
    const context = this.approvalContext();
    const choices = this.approvalChoices();
    if (proformaId == null || quotationId == null || context == null || this.approvalBusy()) return;
    const blocked = approvalChoicesError(choices);
    if (blocked) {
      this.approvalError.set(blocked);
      return;
    }
    this.approvalBusy.set(true);
    this.approvalError.set(null);
    const reference =
      context.proforma?.correlativo?.trim() ||
      context.quotation.correlativo?.trim() ||
      `Cotización #${quotationId}`;
    this.api
      .patch(proformaId, { status: 'APROBADA', sold_items: soldItemsPayload(choices) })
      .pipe(
        switchMap((updated) =>
          this.saleApproval
            .finishApprovedSale({
              quotationId,
              logisticsOrderId: updated.logistics_order_id,
              choices,
              paymentMethods: context.quotation.payment_methods,
              money: context.quotation.money,
              reference,
            })
            .pipe(
              catchError((err) =>
                of({
                  logisticsOrderId: updated.logistics_order_id ?? null,
                  drafts: [],
                  stockLines: [],
                  warnings: [
                    `La venta quedó aprobada, pero no se pudieron armar los borradores. ${this.fmt(err)}`,
                  ],
                } satisfies SaleApprovalResult),
              ),
            ),
        ),
      )
      .subscribe({
        next: (result) => this.finishApproval(quotationId, result),
        error: (err) => {
          this.approvalBusy.set(false);
          this.approvalError.set(this.fmt(err));
        },
      });
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
    const t = plainTextFromHtml(text).replace(/\s+/g, ' ');
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
    this.filterWorkflow.set('ALL');
    this.filterQueue.set('ALL');
    this.filterPriority.set('ALL');
    this.listTab.set('all');
    this.resetListPagingAfterFilter();
  }

  onFilterWorkflowChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterWorkflow.set(v === 'ALL' ? 'ALL' : (v as ProformaWorkflowStatus));
    this.resetListPagingAfterFilter();
  }

  onFilterQueueChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterQueue.set(v === 'ALL' ? 'ALL' : (v as TaskQueue));
    this.resetListPagingAfterFilter();
  }

  onFilterPriorityChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.filterPriority.set(v === 'ALL' ? 'ALL' : (v as ProformaPriority));
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
    const ticket = ++this.listTicket;
    this.errorMessage.set(null);
    const cached = this.api.peekList();
    if (cached?.length) {
      this.items.set(cached);
      this.clampPageIndex();
      this.loading.set(false);
      this.loadingMore.set(false);
      return;
    }
    if (!this.items().length) this.loading.set(true);
    else this.loadingMore.set(true);
    this.listSub?.unsubscribe();
    this.listSub = this.api.listIncremental().subscribe({
      next: (page) => {
        if (ticket !== this.listTicket) return;
        this.items.set(page.rows);
        this.clampPageIndex();
        this.loading.set(false);
        this.loadingMore.set(!page.done);
      },
      error: (err) => {
        if (ticket !== this.listTicket) return;
        this.loading.set(false);
        this.loadingMore.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /** Libera el backend local: el listado y el índice de clientes no deben competir con el alta. */
  private pauseBackgroundLoads(): void {
    this.listSub?.unsubscribe();
    this.listSub = null;
    this.loadingMore.set(false);
    this.clientsApi.cancelCompanyPrefetch();
  }

  private resumeBackgroundListIfIncomplete(): void {
    if (this.listSub || this.api.peekList()?.length) return;
    this.reload();
  }

  rememberClients(rows: ClientRow[]): void {
    if (!rows.length) return;
    this.clients.update((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]));
      for (const row of rows) byId.set(row.id, row);
      return [...byId.values()];
    });
  }

  scheduleClientSearch(raw: string): void {
    const q = raw.trim();
    const ticket = ++this.clientSearchTicket;
    if (this.clientSearchTimer != null) clearTimeout(this.clientSearchTimer);
    if (q.length < CLIENT_SEARCH_MIN) {
      this.clientSearchResults.set([]);
      this.clientsLoading.set(false);
      return;
    }
    this.clientsLoading.set(true);
    this.clientSearchTimer = setTimeout(() => {
      this.clientsApi.searchCompany(q).subscribe({
        next: (rows) => {
          if (ticket !== this.clientSearchTicket) return;
          this.clientSearchResults.set(rows);
          this.rememberClients(rows);
        },
        error: (err) => {
          if (ticket !== this.clientSearchTicket) return;
          this.clientsLoading.set(false);
          this.errorMessage.set(this.fmt(err));
        },
        complete: () => {
          if (ticket !== this.clientSearchTicket) return;
          this.clientsLoading.set(false);
        },
      });
    }, 250);
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
        priority: 'NORMAL',
        due_at: '',
        description: '',
        quotation: 0,
      },
      { emitEvent: false },
    );
    this.resetRequestItems();
    this.form.controls.status.enable({ emitEvent: false });
    this.form.controls.quotation.enable({ emitEvent: false });
    this.quotationSummaryClientId = null;
    this.clearQuotationSummaries();
    this.clientSearchQuery.set('');
    this.clientSearchResults.set([]);
    this.clientsLoading.set(false);
    this.clientPickerOpen.set(false);
    this.clearClientContext();
    this.clearAttachmentDraft();
    this.errorMessage.set(null);
    this.modalOpen.set(true);
    this.loadAssignableUsers();
  }

  private applyRowToForm(row: ProformaRequestRow): void {
    this.form.patchValue(
      {
        client: row.client,
        assigned_user: this.rowAssignedUserPk(row) || 0,
        entry_channel: row.entry_channel,
        proforma_type: row.proforma_type,
        status: this.rowStatus(row),
        priority: row.priority ?? 'NORMAL',
        due_at: row.due_at ? row.due_at.slice(0, 16) : '',
        description: row.description,
        quotation: row.quotation ?? 0,
      },
      { emitEvent: false },
    );
  }

  openEdit(row: ProformaRequestRow): void {
    if (!this.canEdit(row)) return;
    this.editingId.set(row.id);
    this.modalView.set('proforma');
    this.quotationSummaryClientId = this.positiveId(row.client);
    this.applyRowToForm(row);
    this.api.retrieve(row.id).subscribe({
      next: (full) => {
        if (this.editingId() !== full.id) return;
        this.applyRowToForm(full);
      },
      error: () => undefined,
    });
    if (this.rowStatus(row) === 'APROBADA') {
      this.form.controls.status.disable({ emitEvent: false });
      this.form.controls.quotation.disable({ emitEvent: false });
    } else {
      this.form.controls.status.enable({ emitEvent: false });
      this.form.controls.quotation.enable({ emitEvent: false });
    }
    this.clientSearchQuery.set(this.clientDisplayName(row));
    this.clientSearchResults.set([]);
    this.clientsLoading.set(false);
    this.clientPickerOpen.set(false);
    this.clearAttachmentDraft();
    this.errorMessage.set(null);
    this.modalOpen.set(true);
    this.loadAttachments(row.id);
    this.loadAssignableUsers();
    this.onClientChosen(row.client);
  }

  closeModal(): void {
    if (this.saving()) return;
    this.recommendPromptForId = null;
    this.modalOpen.set(false);
    this.clearAttachmentDraft();
    this.clearNewClientRucLookup();
    this.consultingRucNewClient.set(false);
    this.resumeBackgroundListIfIncomplete();
  }

  switchToNewClient(): void {
    this.pauseBackgroundLoads();
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
    this.resumeBackgroundListIfIncomplete();
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

  private onClientChosen(cid: number): void {
    const id = this.positiveId(cid);
    if (id == null) {
      this.quotationSummaryClientId = null;
      this.clearClientContext();
      this.clearQuotationSummaries();
      if (this.form.controls.quotation.value !== 0) {
        this.form.patchValue({ quotation: 0 }, { emitEvent: false });
      }
      return;
    }
    const switched =
      this.quotationSummaryClientId != null && this.quotationSummaryClientId !== id;
    this.quotationSummaryClientId = id;
    if (switched && this.form.controls.quotation.enabled) {
      this.form.patchValue({ quotation: 0 }, { emitEvent: false });
    }
    this.loadClientContextById(id);
    if (this.editingId() != null) this.loadQuotationSummaries(id);
    else this.clearQuotationSummaries();
  }

  sameQuotationId(a: number, b: number): boolean {
    return (a || 0) === (b || 0);
  }

  quotationSummaryOptions(): QuotationSummary[] {
    const rows = this.quotationSummaries();
    const selected = this.positiveId(this.form.controls.quotation.value);
    if (selected == null || rows.some((row) => row.id === selected)) return rows;
    const editing = this.editingRow();
    const correlativo =
      editing?.quotation === selected ? editing.quotation_correlativo?.trim() || `#${selected}` : `#${selected}`;
    return [
      ...rows,
      {
        id: selected,
        correlativo,
        status: 'PENDIENTE',
        client: this.positiveId(this.form.controls.client.value) ?? 0,
        final_price: '',
      },
    ];
  }

  quotationSummaryLabel(q: QuotationSummary): string {
    const code = q.correlativo?.trim() || `#${q.id}`;
    if (q.final_price == null || q.final_price === '') return code;
    return `${code} · ${this.quotationStatusLabel(q.status)} · ${this.lineMoney(q.final_price)}`;
  }

  lineMoney(value: string | number): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private quotationStatusLabel(status: QuotationSummary['status']): string {
    const labels = { APROBADA: 'Aprobada', PENDIENTE: 'Pendiente', RECHAZADA: 'Rechazada' };
    return labels[status] ?? status;
  }

  private clearQuotationSummaries(): void {
    this.quotationSummaryTicket++;
    this.quotationSummaries.set([]);
    this.quotationSummariesLoading.set(false);
    this.quotationSummariesError.set(null);
  }

  private loadQuotationSummaries(clientId: number): void {
    const id = this.positiveId(clientId);
    if (id == null) {
      this.clearQuotationSummaries();
      return;
    }
    const ticket = ++this.quotationSummaryTicket;
    this.quotationSummariesLoading.set(true);
    this.quotationSummariesError.set(null);
    this.quotationsApi.listSummaryByClient(id).subscribe({
      next: (rows) => {
        if (ticket !== this.quotationSummaryTicket) return;
        this.quotationSummaries.set([...rows].sort((a, b) => b.id - a.id));
        this.quotationSummariesLoading.set(false);
      },
      error: (err) => {
        if (ticket !== this.quotationSummaryTicket) return;
        this.quotationSummaries.set([]);
        this.quotationSummariesLoading.set(false);
        this.quotationSummariesError.set(this.fmt(err));
      },
    });
  }

  private positiveId(value: unknown): number | null {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
    return n;
  }

  private clearClientContext(): void {
    this.contactsForClient.set([]);
    this.contactsLoading.set(false);
    this.clientSalesSummary.set(null);
    this.clientSalesSummaryLoading.set(false);
  }

  private contactsFromLookup(contacts: ClientLookupContactItem[], clientId: number): ClientContactRow[] {
    return contacts
      .filter((item) => Number(item.id) > 0)
      .map((item) => ({
        id: item.id,
        client: clientId,
        contact_first_name: item.contact_first_name,
        contact_last_name: item.contact_last_name,
        email: item.email,
        phone: item.phone,
        user: item.assigned_user?.id ?? null,
        encargado: item.assigned_user
          ? {
              id: item.assigned_user.id,
              username: item.assigned_user.username,
              first_name: item.assigned_user.first_name,
              last_name: item.assigned_user.last_name,
              nombre: item.assigned_user.nombre,
            }
          : null,
      }));
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
    this.contactsLoading.set(true);
    this.loadClientSalesSummary(client);
  }

  private loadClientSalesSummary(client: ClientRow): void {
    const ruc = client.ruc?.trim();
    if (!ruc) {
      this.clientSalesSummary.set(null);
      this.clientSalesSummaryLoading.set(false);
      this.loadContactsForSelectedClient(client.id);
      return;
    }
    this.clientSalesSummaryLoading.set(true);
    this.clientSalesSummary.set(null);
    this.clientsApi.lookupByRuc(ruc, 'company').subscribe({
      next: (res) => {
        this.clientSalesSummary.set(res.sales_summary);
        this.clientSalesSummaryLoading.set(false);
        this.contactsForClient.set(this.contactsFromLookup(res.contacts ?? [], client.id));
        this.contactsLoading.set(false);
        const ownerId = coerceUserPk(res.sales_summary?.primary_sales_user?.id);
        if (this.editingId() == null && ownerId != null && !this.hasSelectedAssignedUser()) {
          this.form.patchValue({ assigned_user: ownerId }, { emitEvent: false });
        }
      },
      error: () => {
        this.clientSalesSummary.set(null);
        this.clientSalesSummaryLoading.set(false);
        this.loadContactsForSelectedClient(client.id);
      },
    });
  }

  onClientSearchInput(ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this.clientSearchQuery.set(value);
    this.clientPickerOpen.set(true);
    this.scheduleClientSearch(value);
  }

  onClientSearchFocus(): void {
    this.clientPickerOpen.set(true);
    const q = this.clientSearchQuery().trim();
    if (q.length >= CLIENT_SEARCH_MIN) this.scheduleClientSearch(q);
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
    this.pauseBackgroundLoads();
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
    const existingContacts = this.contactsFromLookup(this.existingClientLookupContacts(), hit.id);
    const dup = this.findDuplicateContactRow(existingContacts, fn, ln);
    if (dup) {
      const dupLabel = [dup.contact_first_name, dup.contact_last_name].filter(Boolean).join(' ').trim();
      if (
        !window.confirm(
          `Ya existe un contacto con el mismo nombre (#${dup.id}: «${dupLabel}»). ¿Crear otro igual?`,
        )
      ) {
        return;
      }
    }
    this.pauseBackgroundLoads();
    this.contactSaving.set(true);
    this.errorMessage.set(null);
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
        next: (created) => {
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
          this.form.patchValue({ client: hit.id, assigned_user: sel.id }, { emitEvent: false });
          this.clientSearchQuery.set(hit.name);
          this.clientPickerOpen.set(false);
          this.quotationSummaryClientId = hit.id;
          this.contactsForClient.set([
            ...existingContacts.filter((row) => row.id !== created.id),
            created,
          ]);
          this.contactsLoading.set(false);
          this.backToProformaForm();
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
    this.pauseBackgroundLoads();
    this.saving.set(true);
    this.errorMessage.set(null);
    this.clientsApi.create(payload).subscribe({
      next: (created) => {
        const contact = this.seedContactFromNewClient(created, payload, sel);
        this.applyCreatedClientToProforma(created, sel, contact);
        this.saving.set(false);
        this.assignAdvisorToInitialContact(created.id, sel, contact);
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private applyCreatedClientToProforma(
    created: ClientRow,
    advisor: AssignableUser,
    contact: ClientContactRow,
  ): void {
    this.clearNewClientRucLookup();
    this.rememberClients([created]);
    this.quotationSummaryClientId = created.id;
    this.clearQuotationSummaries();
    this.clientSalesSummary.set(null);
    this.clientSalesSummaryLoading.set(false);
    this.contactsForClient.set([contact]);
    this.contactsLoading.set(false);
    this.form.patchValue({ client: created.id, assigned_user: advisor.id }, { emitEvent: false });
    this.clientSearchQuery.set(created.name);
    this.clientPickerOpen.set(false);
    this.modalView.set('proforma');
  }

  private seedContactFromNewClient(
    created: ClientRow,
    payload: ClientCreatePayload,
    advisor: AssignableUser,
  ): ClientContactRow {
    return {
      id: this.contactIdFromCreatedClient(created) ?? 0,
      client: created.id,
      contact_first_name: payload.contact.contact_first_name,
      contact_last_name: payload.contact.contact_last_name,
      email: payload.contact.email ?? null,
      phone: payload.contact.phone ?? null,
      user: advisor.id,
      encargado: {
        id: advisor.id,
        username: advisor.username,
        first_name: advisor.first_name,
        last_name: advisor.last_name,
        nombre: advisor.nombre,
      },
    };
  }

  private contactIdFromCreatedClient(created: ClientRow): number | null {
    const raw = created as ClientRow & { contact?: unknown; contacts?: unknown };
    const nested = Array.isArray(raw.contacts) ? raw.contacts : raw.contact != null ? [raw.contact] : [];
    for (const item of nested) {
      if (!item || typeof item !== 'object') continue;
      const id = Number((item as { id?: unknown }).id);
      if (Number.isInteger(id) && id > 0) return id;
    }
    return null;
  }

  /**
   * POST /clients/ no admite asignar vendedor en el contacto anidado; se hace después vía client-contacts.
   * No bloquea el spinner: el cliente ya quedó seleccionado en el formulario.
   */
  private assignAdvisorToInitialContact(
    clientId: number,
    advisor: AssignableUser,
    seed: ClientContactRow,
  ): void {
    const assignBody = this.contactAssignBodyForAdvisor(advisor);

    const apply = (contact: ClientContactRow): void => {
      if (this.form.controls.client.value !== clientId) return;
      this.contactsForClient.set([
        {
          ...contact,
          user: advisor.id,
          encargado: {
            id: advisor.id,
            username: advisor.username,
            first_name: advisor.first_name,
            last_name: advisor.last_name,
            nombre: advisor.nombre,
          },
        },
      ]);
      this.contactsLoading.set(false);
    };

    const patchIfNeeded = (contact: ClientContactRow): void => {
      if (this.contactAssignedToAdvisor(contact, advisor)) {
        apply(contact);
        return;
      }
      this.contactsApi.patch(contact.id, assignBody).subscribe({
        next: (updated) => apply({ ...contact, ...updated }),
        error: (err) => {
          if (this.form.controls.client.value !== clientId) return;
          this.errorMessage.set(
            `Cliente creado (#${clientId}), pero no se pudo asignar al asesor: ${this.fmt(err)}`,
          );
        },
      });
    };

    if (seed.id > 0) {
      patchIfNeeded(seed);
      return;
    }

    const tryLoadContacts = (attempt: number): void => {
      this.contactsApi.listForClient(clientId).subscribe({
        next: (contacts) => {
          const contact = contacts.find((c) => c.client === clientId) ?? contacts[0];
          if (!contact) {
            if (attempt < 1) {
              window.setTimeout(() => tryLoadContacts(attempt + 1), 200);
              return;
            }
            return;
          }
          patchIfNeeded(contact);
        },
        error: () => undefined,
      });
    };

    tryLoadContacts(0);
  }

  private contactAssignedToAdvisor(contact: ClientContactRow, advisor: AssignableUser): boolean {
    const candidates: unknown[] = [contact.user, contact.owner, contact.owner_user?.id, contact.encargado?.id];
    return candidates.some((value) => {
      const pk = coerceUserPk(value);
      if (pk == null) return false;
      if (pk === advisor.id) return true;
      return advisor.profileId != null && pk === advisor.profileId;
    });
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
      const quotationId = this.positiveId(v.quotation);
      const items = this.requestItemsPayload();
      this.api
        .create({
          client: v.client,
          assigned_user: assignedPk,
          entry_channel: v.entry_channel,
          proforma_type: v.proforma_type,
          status: v.status,
          priority: v.priority,
          ...(v.due_at ? { due_at: new Date(v.due_at).toISOString() } : {}),
          description: v.description.trim(),
          ...(items.length ? { request_items: items } : {}),
          ...(quotationId != null ? { quotation: quotationId } : {}),
        })
        .subscribe({
          next: (row) => {
            if (row.assigned_user !== assignedPk) {
              this.saving.set(false);
              const filesNote =
                this.pendingFiles().length > 0 ? ' Los archivos elegidos no se subieron.' : '';
              this.errorMessage.set(
                `La solicitud se creó, pero el asesor asignado en el servidor (#${row.assigned_user}) no coincide con «${sel.nombre}» (#${assignedPk}). Revise con soporte o reasigne editando la solicitud.${filesNote}`,
              );
              this.reload();
              return;
            }
            this.recommendPromptForId = row.id;
            this.createFlowRow.set(row);
            this.finishWithAttachments(row.id);
          },
          error: (err) => this.onSaveErr(err),
        });
      return;
    }

    const existing = this.items().find((row) => row.id === id);
    const patch: ProformaRequestPatchPayload = {
      client: v.client,
      assigned_user: assignedPk,
      entry_channel: v.entry_channel,
      proforma_type: v.proforma_type,
      description: v.description.trim(),
      priority: v.priority,
      due_at: v.due_at ? new Date(v.due_at).toISOString() : null,
    };
    const approved = !!existing && this.rowStatus(existing) === 'APROBADA';
    if (!approved) {
      patch.status = v.status;
      const nextQuotation = this.positiveId(v.quotation);
      const prevQuotation = this.positiveId(existing?.quotation);
      if (nextQuotation !== prevQuotation) patch.quotation = nextQuotation;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.api.patch(id, patch).subscribe({
      next: () => {
        const nextStatus = patch.status ?? (existing ? this.rowStatus(existing) : v.status);
        this.closeFlowIfAbandoned(id, nextStatus, () => this.finishWithAttachments(id));
      },
      error: (err) => this.onSaveErr(err),
    });
  }

  onAttachmentFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const problems: string[] = [];
    const accepted: PendingProformaFile[] = [];
    for (const file of files) {
      const problem = attachmentFileProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      accepted.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    this.attachmentHint.set(problems.length > 0 ? problems.join(' ') : null);
    if (accepted.length > 0) {
      this.pendingFiles.update((current) => [...current, ...accepted]);
    }
  }

  removePendingFile(key: string): void {
    const item = this.pendingFiles().find((row) => row.key === key);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.pendingFiles.update((current) => current.filter((row) => row.key !== key));
  }

  removeSavedAttachment(att: ProformaRequestAttachment): void {
    const requestId = this.editingId();
    if (requestId == null || this.deletingAttachmentId() != null) return;
    if (!window.confirm(`¿Quitar «${att.name}» de la solicitud?`)) return;
    this.deletingAttachmentId.set(att.id);
    this.attachmentHint.set(null);
    this.api.deleteAttachment(requestId, att.id).subscribe({
      next: () => {
        this.deletingAttachmentId.set(null);
        this.savedAttachments.update((rows) => rows.filter((row) => row.id !== att.id));
      },
      error: (err) => {
        this.deletingAttachmentId.set(null);
        this.attachmentHint.set(this.fmt(err));
      },
    });
  }

  isImageType(contentType: string): boolean {
    return contentType.startsWith('image/');
  }

  fileKindLabel(contentType: string, name: string): string {
    if (this.isImageType(contentType) || /\.(jpe?g|png|webp|gif)$/i.test(name)) return 'Imagen';
    if (contentType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'PDF';
    return 'Excel';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    const code = this.requestCode(row);
    if (
      !window.confirm(
        `¿Eliminar la proforma ${code} y todo lo relacionado (ítems, ofertas, adjuntos, tareas, cotización y orden interna)?`,
      )
    ) {
      return;
    }
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
    const promptId = this.recommendPromptForId;
    this.recommendPromptForId = null;
    this.saving.set(false);
    this.clearAttachmentDraft();
    this.modalOpen.set(false);
    this.reload();
    this.loadTaskSummary();
    if (promptId != null) this.startCreateFlow(promptId);
  }

  recMatchKey(lineIndex: number, productId: number): string {
    return `${lineIndex}:${productId}`;
  }

  isRecMatchSelected(lineIndex: number, productId: number): boolean {
    return this.selectedRecKeys().includes(this.recMatchKey(lineIndex, productId));
  }

  toggleRecMatch(lineIndex: number, match: ProformaRecommendationMatch): void {
    const key = this.recMatchKey(lineIndex, match.product_id);
    this.selectedRecKeys.update((keys) =>
      keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key],
    );
  }

  private startCreateFlow(requestId: number): void {
    const existing = this.createFlowRow();
    const row = existing?.id === requestId ? existing : this.items().find((item) => item.id === requestId) ?? null;
    if (row) this.createFlowRow.set(row);
    this.recommendRequestId.set(requestId);
    this.selectedRecKeys.set([]);
    this.createFlowStep.set('recommend');
    this.manualPath.set(null);
    this.pickedCatalog.set(null);
    this.logisticsError.set(null);
    this.recommendOpen.set(true);
    this.runRecommendation(requestId);
  }

  /** Desde el listado: muestra o genera la recomendación y sigue el flujo. */
  openRecommendation(row: ProformaRequestRow): void {
    if (!this.canEdit(row)) return;
    this.createFlowRow.set(row);
    this.recommendRequestId.set(row.id);
    this.selectedRecKeys.set([]);
    this.createFlowStep.set('recommend');
    this.manualPath.set(null);
    this.recommendError.set(null);
    this.recommendPhase.set('loading');
    this.recommendOpen.set(true);
    this.api.getRecommendation(row.id).subscribe({
      next: (rec) => {
        if (this.recommendRequestId() !== row.id) return;
        this.recommend.set(rec);
        this.recommendPhase.set('result');
      },
      error: (err) => {
        if (this.recommendRequestId() !== row.id) return;
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.runRecommendation(row.id);
          return;
        }
        this.recommendError.set(this.fmt(err));
        this.recommendPhase.set('error');
      },
    });
  }

  confirmRecommendation(): void {
    const requestId = this.recommendRequestId();
    if (requestId == null) return;
    this.runRecommendation(requestId);
  }

  private runRecommendation(requestId: number): void {
    this.recommendPhase.set('loading');
    this.recommendError.set(null);
    this.createFlowStep.set('recommend');
    this.api.recommend(requestId).subscribe({
      next: (rec) => {
        if (this.recommendRequestId() !== requestId) return;
        this.recommend.set(rec);
        this.recommendPhase.set('result');
      },
      error: (err) => {
        if (this.recommendRequestId() !== requestId) return;
        this.recommendError.set(this.fmt(err));
        this.recommendPhase.set('error');
      },
    });
  }

  closeRecommend(): void {
    if (this.recommendPhase() === 'loading' || this.logisticsSending()) return;
    this.recommendOpen.set(false);
    this.recommend.set(null);
    this.recommendError.set(null);
    this.createFlowRow.set(null);
    this.selectedRecKeys.set([]);
    this.manualPath.set(null);
    this.pickedCatalog.set(null);
  }

  openManualChoice(): void {
    this.createFlowStep.set('manual');
    this.manualPath.set(null);
    this.logisticsError.set(null);
  }

  backToRecommendations(): void {
    this.createFlowStep.set('recommend');
    this.manualPath.set(null);
  }

  openCatalogPick(): void {
    this.manualPath.set('pick');
    this.pickedCatalog.set(null);
    if (this.catalogProducts().length) return;
    this.catalogLoading.set(true);
    this.productsApi.list().subscribe({
      next: (rows) => {
        this.catalogProducts.set(rows);
        this.catalogLoading.set(false);
      },
      error: (err) => {
        this.catalogLoading.set(false);
        this.logisticsError.set(this.fmt(err));
      },
    });
  }

  openLogisticsAssign(): void {
    this.manualPath.set('logistics');
    this.logisticsUserId.set(0);
    this.logisticsError.set(null);
    this.logisticsUsersLoading.set(true);
    forkJoin([this.api.assignableUsers('LOGISTICA'), this.api.assignableUsers('ADMIN')]).subscribe({
      next: ([logistics, admin]) => {
        const byId = new Map<number, AssignableUser>();
        for (const raw of [...logistics, ...admin]) {
          const user = this.normalizeAssignableUser(raw);
          if (user) byId.set(user.id, user);
        }
        this.logisticsUsers.set(
          [...byId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
        );
        this.logisticsUsersLoading.set(false);
      },
      error: (err) => {
        this.logisticsUsersLoading.set(false);
        this.logisticsError.set(this.fmt(err));
      },
    });
  }

  quoteRecommendationMatch(lineIndex: number, match: ProformaRecommendationMatch, qty: number): void {
    this.goToQuotationWithProducts([
      { id: match.product_id, qty, inStock: match.availability === 'STOCK' || match.stock > 0 },
    ]);
  }

  quoteSelectedRecommendations(): void {
    const rec = this.recommend();
    if (!rec) return;
    const selected = new Set(this.selectedRecKeys());
    const products: { id: number; qty: number; inStock: boolean }[] = [];
    rec.lines.forEach((line, lineIndex) => {
      for (const match of line.matches) {
        if (!selected.has(this.recMatchKey(lineIndex, match.product_id))) continue;
        products.push({
          id: match.product_id,
          qty: line.qty || 1,
          inStock: match.availability === 'STOCK' || match.stock > 0,
        });
      }
    });
    if (!products.length) return;
    this.goToQuotationWithProducts(products);
  }

  quotePickedCatalogProduct(): void {
    const product = this.pickedCatalog();
    if (!product) return;
    this.goToQuotationWithProducts([{ id: product.id, qty: 1 }]);
  }

  private goToQuotationWithProducts(products: { id: number; qty: number; inStock?: boolean }[]): void {
    const row = this.createFlowRow();
    if (!row) return;
    this.recommendOpen.set(false);
    void this.router.navigate(['/ventas/cotizaciones'], {
      queryParams: {
        proformaRequest: row.id,
        client: row.client,
        assignedUser: row.assigned_user,
        products: products.map((item) => `${item.id}:${item.qty}${item.inStock ? ':S' : ''}`).join(','),
      },
    });
  }

  submitCreateFlowLogistics(): void {
    const row = this.createFlowRow();
    const userId = this.logisticsUserId();
    if (!row || userId <= 0) {
      this.logisticsError.set('Seleccione un usuario de Logística o un administrador.');
      return;
    }
    this.logisticsSending.set(true);
    this.logisticsError.set(null);
    this.api.sendToLogistics(row.id, { assigned_user: userId, reason: 'Derivado tras revisar recomendaciones' }).subscribe({
      next: () => {
        this.logisticsSending.set(false);
        this.closeRecommend();
        this.reload();
        this.loadTaskSummary();
        this.detailId.set(row.id);
      },
      error: (err) => {
        this.logisticsSending.set(false);
        this.logisticsError.set(this.fmt(err));
      },
    });
  }

  availabilityLabel(value: RecommendationLineAvailability): string {
    if (value === 'STOCK') return 'En stock';
    if (value === 'IMPORTACION') return 'Importación';
    return 'No encontrado';
  }

  /** Sube los archivos elegidos cuando la solicitud ya tiene id. Uno por request. */
  private finishWithAttachments(requestId: number): void {
    this.editingId.set(requestId);
    const batch = [...this.pendingFiles()];
    if (batch.length === 0) {
      this.afterSaveOk();
      return;
    }
    from(batch)
      .pipe(
        concatMap((item) =>
          this.api.uploadAttachment(requestId, item.file).pipe(
            tap(() => this.removePendingFile(item.key)),
          ),
        ),
        toArray(),
        map(() => undefined),
      )
      .subscribe({
        next: () => this.afterSaveOk(),
        error: (err) => {
          this.saving.set(false);
          this.loadAttachments(requestId);
          this.reload();
          this.errorMessage.set(
            `La solicitud #${requestId} se guardó, pero no se pudieron subir todos los archivos. ${this.fmt(err)}`,
          );
        },
      });
  }

  private loadAttachments(requestId: number): void {
    this.attachmentsLoading.set(true);
    this.api.listAttachments(requestId).subscribe({
      next: (rows) => {
        if (this.editingId() !== requestId) return;
        this.savedAttachments.set(rows);
        this.attachmentsLoading.set(false);
      },
      error: (err) => {
        if (this.editingId() !== requestId) return;
        this.attachmentsLoading.set(false);
        this.attachmentHint.set(this.fmt(err));
      },
    });
  }

  private clearAttachmentDraft(): void {
    this.clearPendingFiles();
    this.savedAttachments.set([]);
    this.attachmentHint.set(null);
    this.attachmentsLoading.set(false);
    this.deletingAttachmentId.set(null);
  }

  private clearPendingFiles(): void {
    for (const item of this.pendingFiles()) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    this.pendingFiles.set([]);
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

  private finishApproval(quotationId: number, result: SaleApprovalResult): void {
    this.approvalBusy.set(false);
    this.approvalResult.set(result);
    const orderId = result.logisticsOrderId;
    if (orderId != null && orderId > 0) {
      this.logisticsOrderByQuotation.update((current) => ({ ...current, [quotationId]: orderId }));
    }
    this.reload();
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
