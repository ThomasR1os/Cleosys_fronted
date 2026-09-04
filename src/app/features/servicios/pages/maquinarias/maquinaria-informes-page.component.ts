import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { concatMap, filter, firstValueFrom, forkJoin, from, map, switchMap, toArray } from 'rxjs';
import { ShortDateTimePipe } from '../../../../core/pipes/short-datetime.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { CompanyService } from '../../../admin/services/company.service';
import { DEFAULT_COMPANY_BRANDING } from '../../../admin/utils/company-branding.utils';
import { imageUrlToDataUrl } from '../../../core/pages/productos/product-ficha-pdf.util';
import { ClientService } from '../../../ventas/services/client.service';
import type {
  ControlVoltage,
  ElectricalEvaluation,
  ElectricalEvaluationWritePayload,
  Machine,
  NominalVoltage,
  PartCheckCondition,
  ReportCondition,
  ReportPhoto,
  ReportPhotoLabel,
  ReportType,
  ServiceReport,
  ServiceReportWritePayload,
  StarterType,
  SubcategoryRecommendedPart,
} from '../../models/servicios.models';
import { MachineService } from '../../services/machine.service';
import { ServiceReportService } from '../../services/service-report.service';
import { SubcategoryRecommendedPartService } from '../../services/subcategory-recommended-part.service';
import { downloadServiceReportPdf } from '../../utils/service-report-pdf.util';

type TypeFilter = 'ALL' | ReportType;
type ModalMode = 'create' | 'edit' | 'view';

type PartCheckRow = {
  recommended_part: number;
  name: string;
  condition: PartCheckCondition;
  part_number: string;
  notes: string;
};

type PendingPhoto = {
  key: string;
  file: File;
  label: ReportPhotoLabel;
  note: string;
  previewUrl: string;
};

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
  selector: 'app-maquinaria-informes-page',
  imports: [RouterLink, ReactiveFormsModule, DecimalPipe, ShortDateTimePipe],
  templateUrl: './maquinaria-informes-page.component.html',
})
export class MaquinariaInformesPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly machinesApi = inject(MachineService);
  private readonly reportsApi = inject(ServiceReportService);
  private readonly partsApi = inject(SubcategoryRecommendedPartService);
  private readonly companyApi = inject(CompanyService);
  private readonly clientsApi = inject(ClientService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly machine = signal<Machine | null>(null);
  readonly reports = signal<ServiceReport[]>([]);
  readonly loading = signal(false);
  readonly reportsLoading = signal(false);
  readonly saving = signal(false);
  readonly partsLoading = signal(false);
  readonly photosLoading = signal(false);
  readonly photoUploadBusy = signal(false);
  readonly pdfGeneratingId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly modalErrorMessage = signal<string | null>(null);

  readonly filterType = signal<TypeFilter>('ALL');
  readonly modalOpen = signal(false);
  readonly modalMode = signal<ModalMode>('create');
  readonly editingId = signal<number | null>(null);
  readonly formType = signal<ReportType>('EVALUATION');
  readonly partChecks = signal<PartCheckRow[]>([]);
  readonly photos = signal<ReportPhoto[]>([]);
  readonly pendingPhotos = signal<PendingPhoto[]>([]);
  readonly newPhotoLabel = signal<ReportPhotoLabel>('BEFORE');
  readonly newPhotoNote = signal('');
  readonly modalCorrelativo = signal<string | null>(null);
  readonly showElectricalEval = signal(true);
  private pendingPhotoKey = 0;

  readonly statusLabels: Record<string, string> = {
    ACTIVE: 'Activa',
    OUT_OF_SERVICE: 'Fuera de servicio',
    DECOMMISSIONED: 'Dada de baja',
  };

  readonly typeOptions: { value: ReportType; label: string }[] = [
    { value: 'EVALUATION', label: 'Evaluación' },
    { value: 'SERVICE', label: 'Servicio' },
  ];

  readonly conditionOptions: { value: ReportCondition; label: string }[] = [
    { value: 'OPERATIONAL', label: 'Operativo' },
    { value: 'INOPERATIVE', label: 'Inoperativo' },
  ];

  readonly partConditionOptions: { value: PartCheckCondition; label: string }[] = [
    { value: 'OK', label: 'OK' },
    { value: 'REPLACE', label: 'Reemplazar' },
    { value: 'CLEAN', label: 'Limpiar' },
  ];

  readonly photoLabelOptions: { value: ReportPhotoLabel; label: string }[] = [
    { value: 'BEFORE', label: 'Antes' },
    { value: 'DURING', label: 'Durante' },
    { value: 'AFTER', label: 'Después' },
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

  readonly photosByLabel = computed(() => {
    const groups: { value: ReportPhotoLabel; label: string; items: ReportPhoto[] }[] = [];
    for (const opt of this.photoLabelOptions) {
      groups.push({
        ...opt,
        items: this.photos().filter((p) => p.label === opt.value),
      });
    }
    return groups;
  });

  readonly filteredReports = computed(() => {
    const type = this.filterType();
    const list = this.reports();
    if (type === 'ALL') return list;
    return list.filter((r) => r.type === type);
  });

  readonly evaluationOptions = computed(() =>
    this.reports()
      .filter((r) => r.type === 'EVALUATION')
      .slice()
      .sort((a, b) => b.id - a.id),
  );

  readonly machineHourMeter = computed(() => this.machine()?.current_hour_meter ?? null);

  readonly workPerformedLabel = computed(() =>
    this.formType() === 'SERVICE' ? 'Trabajos realizados' : 'Inspecciones realizadas',
  );

  readonly form = this.fb.nonNullable.group({
    id: this.fb.control<number | null>(null),
    type: this.fb.nonNullable.control<ReportType>('EVALUATION'),
    origin_report: this.fb.control<number | null>(null),
    intervention_date: ['', Validators.required],
    hour_meter: this.fb.control<number | null>(null),
    current_condition: this.fb.control<string>('OPERATIONAL'),
    work_performed: [''],
    background: [''],
    conclusions: [''],
    recommendations: [''],
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

  readonly modalReadonly = computed(() => this.modalMode() === 'view');

  get evalGroup() {
    return this.form.controls.eval;
  }

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
        filter((id) => !Number.isNaN(id) && id > 0),
        switchMap((id) => {
          this.loading.set(true);
          this.reportsLoading.set(true);
          this.clearErrors('all');
          this.machine.set(null);
          this.reports.set([]);
          return forkJoin({
            machine: this.machinesApi.get(id),
            reports: this.reportsApi.listForMachine(id),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ machine, reports }) => {
          this.machine.set(machine);
          this.reports.set(this.sortReports(reports));
          this.loading.set(false);
          this.reportsLoading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.reportsLoading.set(false);
          this.showError(err, 'page');
        },
      });

    this.form.controls.current_condition.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.syncElectricalVisibility(v));
  }

  private sortReports(rows: ServiceReport[]): ServiceReport[] {
    return rows.slice().sort((a, b) => {
      const da = a.intervention_date || '';
      const db = b.intervention_date || '';
      if (da !== db) return db.localeCompare(da);
      return b.id - a.id;
    });
  }

  statusLabel(status: string): string {
    return this.statusLabels[status] ?? status;
  }

  typeLabel(type: string): string {
    return this.typeOptions.find((o) => o.value === type)?.label ?? type;
  }

  conditionLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return this.conditionOptions.find((o) => o.value === value)?.label ?? value;
  }

  photoLabelUi(value: string | null | undefined): string {
    if (!value) return '—';
    return this.photoLabelOptions.find((o) => o.value === value)?.label ?? value;
  }

  correlativoLabel(row: Pick<ServiceReport, 'id' | 'correlativo'>): string {
    return row.correlativo?.trim() || `#${row.id}`;
  }

  reportRefLabel(id: number | null | undefined): string {
    if (id == null) return '—';
    const found = this.reports().find((r) => r.id === id);
    return found ? this.correlativoLabel(found) : `#${id}`;
  }

  setFilterType(value: string): void {
    this.filterType.set(value === 'EVALUATION' || value === 'SERVICE' ? value : 'ALL');
  }

  todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  reloadReports(): void {
    const m = this.machine();
    if (!m) return;
    this.reportsLoading.set(true);
    this.clearErrors('page');
    this.reportsApi.listForMachine(m.id).subscribe({
      next: (rows) => {
        this.reports.set(this.sortReports(rows));
        this.reportsLoading.set(false);
      },
      error: (err) => {
        this.reportsLoading.set(false);
        this.showError(err, 'page');
      },
    });
  }

  reloadMachine(): void {
    const m = this.machine();
    if (!m) return;
    this.machinesApi.get(m.id).subscribe({
      next: (updated) => this.machine.set(updated),
      error: () => undefined,
    });
  }

  openNewEvaluation(): void {
    this.openCreate('EVALUATION');
  }

  openNewService(): void {
    this.openCreate('SERVICE');
  }

  private openCreate(type: ReportType): void {
    const m = this.machine();
    if (!m || !this.auth.canWriteReports()) return;
    this.modalMode.set('create');
    this.editingId.set(null);
    this.modalCorrelativo.set(null);
    this.clearErrors('modal');
    this.formType.set(type);
    this.form.reset({
      id: null,
      type,
      origin_report: null,
      intervention_date: this.todayIso(),
      hour_meter: m.current_hour_meter,
      current_condition: 'OPERATIONAL',
      work_performed: '',
      background: '',
      conclusions: '',
      recommendations: '',
      eval: { ...EMPTY_EVAL },
    });
    this.form.enable({ emitEvent: false });
    this.partChecks.set([]);
    this.clearPhotoState();
    this.patchEvalFromApi(m.electrical_evaluation);
    this.syncElectricalVisibility('OPERATIONAL');
    this.modalOpen.set(true);
    if (type === 'EVALUATION') {
      this.loadPartChecksForMachine(m, null);
    }
  }

  openView(row: ServiceReport): void {
    this.modalMode.set('view');
    this.editingId.set(row.id);
    this.modalCorrelativo.set(row.correlativo);
    this.clearErrors('modal');
    this.formType.set((row.type as ReportType) || 'EVALUATION');
    this.patchForm(row);
    this.form.disable({ emitEvent: false });
    this.clearPendingPhotos();
    this.patchEvalFromApi(row.electrical_evaluation);
    this.syncElectricalVisibility(row.current_condition);
    this.modalOpen.set(true);
    this.loadPhotosForReport(row);
    if (row.type === 'EVALUATION') {
      const m = this.machine();
      if (m) this.loadPartChecksForMachine(m, row);
      else this.applyPartChecksFromReport(row);
    } else {
      this.partChecks.set([]);
    }
  }

  openEdit(row: ServiceReport): void {
    if (!this.auth.canWriteReports()) return;
    this.modalMode.set('edit');
    this.editingId.set(row.id);
    this.modalCorrelativo.set(row.correlativo);
    this.clearErrors('modal');
    this.formType.set((row.type as ReportType) || 'EVALUATION');
    this.patchForm(row);
    this.form.enable({ emitEvent: false });
    this.form.controls.type.disable({ emitEvent: false });
    this.clearPendingPhotos();
    this.patchEvalFromApi(row.electrical_evaluation);
    this.syncElectricalVisibility(row.current_condition);
    this.modalOpen.set(true);
    this.loadPhotosForReport(row);
    if (row.type === 'EVALUATION') {
      const m = this.machine();
      if (m) this.loadPartChecksForMachine(m, row);
      else this.applyPartChecksFromReport(row);
    } else {
      this.partChecks.set([]);
    }
  }

  private patchForm(row: ServiceReport): void {
    this.form.patchValue({
      id: row.id,
      type: (row.type as ReportType) || 'EVALUATION',
      origin_report: row.origin_report,
      intervention_date: row.intervention_date || '',
      hour_meter: row.hour_meter,
      current_condition: row.current_condition || 'OPERATIONAL',
      work_performed: row.work_performed ?? '',
      background: row.background ?? '',
      conclusions: row.conclusions ?? '',
      recommendations: row.recommendations ?? '',
    });
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

  private syncElectricalVisibility(condition: string | null | undefined): void {
    const show = condition !== 'INOPERATIVE';
    this.showElectricalEval.set(show);
    if (!show || this.modalReadonly()) {
      this.evalGroup.disable({ emitEvent: false });
    } else {
      this.evalGroup.enable({ emitEvent: false });
    }
  }

  private buildElectricalPayload(): ElectricalEvaluationWritePayload | null {
    if (!this.showElectricalEval()) return null;
    const e = this.evalGroup.getRawValue();
    const nominal = this.nullIfBlank(e.nominal_voltage);
    const starterType = this.nullIfBlank(e.starter_type);
    const starterBrand = this.nullIfBlank(e.starter_brand);
    const control = this.nullIfBlank(e.control_voltage);
    const grounding = this.nullIfBlank(e.grounding);

    const actual = this.buildPhaseLine(e.actual_l1_l2, e.actual_l2_l3, e.actual_l3_l1);
    const main = this.buildPhaseCurrent(e.main_l1, e.main_l2, e.main_l3);
    const fan = this.buildPhaseCurrent(e.fan_l1, e.fan_l2, e.fan_l3);

    if (
      !nominal &&
      !starterType &&
      !starterBrand &&
      !control &&
      !grounding &&
      !actual &&
      !main &&
      !fan
    ) {
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

  private loadPartChecksForMachine(m: Machine, report: ServiceReport | null): void {
    const subId = m.subcategory;
    if (subId == null) {
      this.applyPartChecksFromReport(report);
      return;
    }
    this.partsLoading.set(true);
    this.partsApi.list({ subcategory_id: subId, is_active: true }).subscribe({
      next: (parts) => {
        this.partsLoading.set(false);
        this.partChecks.set(this.mergePartsWithReport(parts, report));
      },
      error: () => {
        this.partsLoading.set(false);
        this.applyPartChecksFromReport(report);
      },
    });
  }

  private applyPartChecksFromReport(report: ServiceReport | null): void {
    if (!report?.part_checks?.length) {
      this.partChecks.set([]);
      return;
    }
    this.partChecks.set(
      report.part_checks.map((c) => ({
        recommended_part: c.recommended_part,
        name: c.recommended_part_name || `Parte #${c.recommended_part}`,
        condition: (c.condition as PartCheckCondition) || 'OK',
        part_number: c.part_number ?? '',
        notes: c.notes ?? '',
      })),
    );
  }

  private mergePartsWithReport(
    parts: SubcategoryRecommendedPart[],
    report: ServiceReport | null,
  ): PartCheckRow[] {
    const byId = new Map(
      (report?.part_checks ?? []).map((c) => [c.recommended_part, c] as const),
    );
    return parts.map((p) => {
      const existing = byId.get(p.id);
      return {
        recommended_part: p.id,
        name: p.name,
        condition: (existing?.condition as PartCheckCondition) || 'OK',
        part_number: existing?.part_number ?? '',
        notes: existing?.notes ?? '',
      };
    });
  }

  setPartCondition(index: number, value: string): void {
    if (this.modalReadonly()) return;
    const cond: PartCheckCondition =
      value === 'REPLACE' || value === 'CLEAN' || value === 'OK' ? value : 'OK';
    this.partChecks.update((rows) =>
      rows.map((r, i) =>
        i === index
          ? {
              ...r,
              condition: cond,
              part_number: cond === 'REPLACE' ? r.part_number : '',
            }
          : r,
      ),
    );
  }

  setPartNumber(index: number, value: string): void {
    if (this.modalReadonly()) return;
    this.partChecks.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, part_number: value } : r)),
    );
  }

  setPartNotes(index: number, value: string): void {
    if (this.modalReadonly()) return;
    this.partChecks.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, notes: value } : r)),
    );
  }

  private loadPhotosForReport(row: ServiceReport): void {
    if (row.photos?.length) {
      this.photos.set(
        row.photos.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
      );
    } else {
      this.photos.set([]);
    }
    this.photosLoading.set(true);
    this.reportsApi.listPhotos(row.id).subscribe({
      next: (rows) => {
        this.photos.set(rows);
        this.photosLoading.set(false);
      },
      error: () => {
        this.photosLoading.set(false);
      },
    });
  }

  setNewPhotoLabel(value: string): void {
    if (value === 'BEFORE' || value === 'DURING' || value === 'AFTER') {
      this.newPhotoLabel.set(value);
    }
  }

  setNewPhotoNote(value: string): void {
    this.newPhotoNote.set(value);
  }

  onPhotoFileSelected(ev: Event): void {
    if (this.modalReadonly() || !this.auth.canWriteReports()) return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.showError('Solo se permiten imágenes.', 'modal');
      return;
    }

    const reportId = this.editingId();
    const label = this.newPhotoLabel();
    const note = this.newPhotoNote().trim();

    // Informe ya guardado: subir ya a Cloudinary.
    if (reportId != null) {
      this.photoUploadBusy.set(true);
      this.clearErrors('modal');
      this.reportsApi
        .uploadPhoto(file, reportId, {
          label,
          note: note || null,
          sort_order: this.photos().length + this.pendingPhotos().length,
        })
        .subscribe({
          next: (photo) => {
            this.photoUploadBusy.set(false);
            this.photos.update((list) =>
              [...list, photo].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
            );
            this.newPhotoNote.set('');
          },
          error: (err) => {
            this.photoUploadBusy.set(false);
            this.showError(err, 'modal');
          },
        });
      return;
    }

    // Alta: encolar hasta guardar el informe.
    const key = `p-${++this.pendingPhotoKey}`;
    this.pendingPhotos.update((list) => [
      ...list,
      {
        key,
        file,
        label,
        note,
        previewUrl: URL.createObjectURL(file),
      },
    ]);
    this.newPhotoNote.set('');
  }

  removePendingPhoto(key: string): void {
    const found = this.pendingPhotos().find((p) => p.key === key);
    if (found?.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(found.previewUrl);
    }
    this.pendingPhotos.update((list) => list.filter((p) => p.key !== key));
  }

  private clearPendingPhotos(): void {
    for (const p of this.pendingPhotos()) {
      if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
    }
    this.pendingPhotos.set([]);
  }

  private clearPhotoState(): void {
    this.clearPendingPhotos();
    this.photos.set([]);
    this.newPhotoLabel.set('BEFORE');
    this.newPhotoNote.set('');
    this.photosLoading.set(false);
    this.photoUploadBusy.set(false);
  }

  private uploadPendingPhotos(reportId: number) {
    const pending = this.pendingPhotos();
    if (!pending.length) {
      return from([[] as ReportPhoto[]]);
    }
    const baseOrder = this.photos().length;
    return from(pending).pipe(
      concatMap((p, index) =>
        this.reportsApi.uploadPhoto(p.file, reportId, {
          label: p.label,
          note: p.note || null,
          sort_order: baseOrder + index,
        }),
      ),
      toArray(),
    );
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.form.enable({ emitEvent: false });
    this.partChecks.set([]);
    this.modalCorrelativo.set(null);
    this.clearErrors('modal');
    this.clearPhotoState();
    this.evalGroup.reset({ ...EMPTY_EVAL });
    this.showElectricalEval.set(true);
  }

  openOriginReport(id: number): void {
    const found = this.reports().find((r) => r.id === id);
    if (found) {
      this.openView(found);
      return;
    }
    this.clearErrors('page');
    this.reportsApi.get(id).subscribe({
      next: (r) => this.openView(r),
      error: (err) => this.showError(err, 'page'),
    });
  }

  save(): void {
    if (this.modalReadonly() || !this.auth.canWriteReports()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const m = this.machine();
    if (!m) return;

    const raw = this.form.getRawValue();
    const type = (raw.type || this.formType()) as ReportType;
    const hour = this.nullIfDecimal(raw.hour_meter);
    const minHour = m.current_hour_meter;

    if (hour != null && minHour != null && hour < minHour) {
      this.showError(
        `El horómetro no puede ser menor que el actual de la máquina (${minHour}).`,
        'modal',
      );
      this.form.controls.hour_meter.setErrors({ minMachine: true });
      return;
    }

    if (type === 'EVALUATION') {
      const bad = this.partChecks().find(
        (c) => c.condition === 'REPLACE' && !c.part_number.trim(),
      );
      if (bad) {
        this.showError(
          `La parte «${bad.name}» marcada como Reemplazar requiere número de parte.`,
          'modal',
        );
        return;
      }
    }

    const payload: ServiceReportWritePayload = {
      type,
      machine: m.id,
      intervention_date: raw.intervention_date,
      hour_meter: hour,
      current_condition: this.nullIfBlank(raw.current_condition),
      work_performed: this.nullIfBlank(raw.work_performed),
      background: this.nullIfBlank(raw.background),
      conclusions: this.nullIfBlank(raw.conclusions),
      recommendations: this.nullIfBlank(raw.recommendations),
    };

    const electrical = this.buildElectricalPayload();
    if (electrical) {
      payload.electrical_evaluation = electrical;
    }

    if (type === 'SERVICE') {
      payload.origin_report = raw.origin_report;
    } else {
      payload.part_checks = this.partChecks().map((c) => ({
        recommended_part: c.recommended_part,
        condition: c.condition,
        part_number: c.condition === 'REPLACE' ? c.part_number.trim() : '',
        notes: this.nullIfBlank(c.notes),
      }));
    }

    const id = this.editingId();
    this.saving.set(true);
    this.clearErrors('modal');

    const req =
      id == null ? this.reportsApi.create(payload) : this.reportsApi.update(id, payload);

    req
      .pipe(
        switchMap((saved) =>
          this.uploadPendingPhotos(saved.id).pipe(map(() => saved)),
        ),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.reloadReports();
          this.reloadMachine();
        },
        error: (err) => {
          this.saving.set(false);
          this.showError(err, 'modal');
          // Si el informe ya se creó, refrescar listado aunque fallen fotos.
          this.reloadReports();
          this.reloadMachine();
        },
      });
  }

  remove(row: ServiceReport): void {
    if (!this.auth.canWriteReports()) return;
    const label = this.typeLabel(row.type);
    if (!window.confirm(`¿Eliminar el informe ${label} ${this.correlativoLabel(row)}?`)) return;
    this.clearErrors('page');
    this.reportsApi.delete(row.id).subscribe({
      next: () => {
        this.reloadReports();
        this.reloadMachine();
      },
      error: (err) => this.showError(err, 'page'),
    });
  }

  async generatePdf(row: ServiceReport): Promise<void> {
    const m = this.machine();
    if (!m) return;
    if (this.pdfGeneratingId() != null) return;
    this.pdfGeneratingId.set(row.id);
    this.clearErrors(this.modalOpen() ? 'modal' : 'page');
    try {
      const [fullReport, photos] = await Promise.all([
        firstValueFrom(this.reportsApi.get(row.id)),
        firstValueFrom(this.reportsApi.listPhotos(row.id)).catch(() => row.photos ?? []),
      ]);
      const companyId = this.auth.me()?.profile?.company?.id ?? null;
      const [companyAssets, client] = await Promise.all([
        this.loadCompanyPdfAssets(companyId),
        this.resolveClientForPdf(m.client),
      ]);
      await downloadServiceReportPdf({
        report: fullReport,
        machine: m,
        client:
          client ??
          (m.client_name
            ? { name: m.client_name, ruc: null, address: null }
            : null),
        company: companyAssets,
        photos: photos.length ? photos : fullReport.photos,
      });
    } catch (err) {
      this.showError(err, this.modalOpen() ? 'modal' : 'page');
    } finally {
      this.pdfGeneratingId.set(null);
    }
  }

  generatePdfFromModal(): void {
    const id = this.editingId();
    if (id == null) return;
    const found = this.reports().find((r) => r.id === id);
    if (found) {
      void this.generatePdf(found);
      return;
    }
    void this.generatePdf({
      id,
      correlativo: this.modalCorrelativo(),
      type: this.formType(),
      machine: this.machine()?.id ?? 0,
      origin_report: null,
      intervention_date: '',
      hour_meter: null,
      current_condition: null,
      work_performed: null,
      background: null,
      conclusions: null,
      recommendations: null,
      part_checks: [],
      photos: this.photos(),
      electrical_evaluation: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    });
  }

  private async resolveClientForPdf(
    clientId: number,
  ): Promise<{ name: string; ruc?: string | null; address?: string | null } | null> {
    try {
      const clients = await firstValueFrom(this.clientsApi.listForCompany());
      const found = clients.find((c) => c.id === clientId);
      if (!found) return null;
      return { name: found.name, ruc: found.ruc, address: found.address ?? null };
    } catch {
      return null;
    }
  }

  private async loadCompanyPdfAssets(companyId: number | null): Promise<{
    name: string;
    logoDataUrl: string | null;
    branding: typeof DEFAULT_COMPANY_BRANDING;
  }> {
    let name = this.auth.companyName() !== '—' ? this.auth.companyName() : '';
    let branding = { ...DEFAULT_COMPANY_BRANDING };
    let logoDataUrl: string | null = null;

    if (companyId != null && companyId > 0) {
      try {
        const co = await firstValueFrom(this.companyApi.retrieve(companyId));
        name = co.name?.trim() || name;
        if (co.branding) branding = { ...DEFAULT_COMPANY_BRANDING, ...co.branding };
        if (co.logo?.trim()) {
          logoDataUrl = await imageUrlToDataUrl(co.logo.trim());
        }
      } catch {
        /* fallback local */
      }
    }

    if (!logoDataUrl) {
      for (const p of ['/branding/company-logo.png', '/branding/company-logo.jpg']) {
        try {
          const blob = await firstValueFrom(this.http.get(p, { responseType: 'blob' }));
          if (!blob.size) continue;
          logoDataUrl = await new Promise<string | null>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
          });
          if (logoDataUrl) break;
        } catch {
          continue;
        }
      }
    }

    return { name, logoDataUrl, branding };
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
