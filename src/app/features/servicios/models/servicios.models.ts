/** Estados de maquinaria (API servicios). */
export type MachineStatus = 'ACTIVE' | 'OUT_OF_SERVICE' | 'DECOMMISSIONED';

export type NominalVoltage = '220V' | '380V' | '440V';
export type StarterType = 'DIRECT' | 'STAR_DELTA' | 'VSD' | 'SOFT';
export type ControlVoltage = '110_VAC' | '220_VAC' | '24_VDC';

/** Fases línea-línea (voltaje real). */
export interface PhaseLineVoltage {
  l1_l2: number | null;
  l2_l3: number | null;
  l3_l1: number | null;
}

/** Fases de corriente (motor principal / ventilador). */
export interface PhaseCurrent {
  l1: number | null;
  l2: number | null;
  l3: number | null;
}

/** Evaluación eléctrica anidada en máquina. */
export interface ElectricalEvaluation {
  id?: number;
  machine?: number;
  nominal_voltage: NominalVoltage | string | null;
  actual_voltage: PhaseLineVoltage | null;
  main_motor_current: PhaseCurrent | null;
  fan_motor_current: PhaseCurrent | null;
  starter_type: StarterType | string | null;
  starter_brand: string | null;
  control_voltage: ControlVoltage | string | null;
  grounding: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Body parcial / anidado al crear o editar máquina. */
export interface ElectricalEvaluationWritePayload {
  nominal_voltage?: NominalVoltage | string | null;
  actual_voltage?: Partial<PhaseLineVoltage> | null;
  main_motor_current?: Partial<PhaseCurrent> | null;
  fan_motor_current?: Partial<PhaseCurrent> | null;
  starter_type?: StarterType | string | null;
  starter_brand?: string | null;
  control_voltage?: ControlVoltage | string | null;
  grounding?: string | null;
}

/** GET/POST/PATCH /api/servicios/machines/ */
export interface Machine {
  id: number;
  company: number | null;
  client: number;
  client_name: string | null;
  brand: number;
  brand_name: string | null;
  category: number | null;
  category_name: string | null;
  subcategory: number | null;
  subcategory_name: string | null;
  model: string;
  serial_number: string;
  plate_image_url: string | null;
  daily_working_hours: number;
  current_hour_meter: number | null;
  location: string;
  status: MachineStatus | string;
  electrical_evaluation: ElectricalEvaluation | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Body de alta/edición (sin `company`: lo asigna el backend). */
export interface MachineWritePayload {
  client: number;
  brand: number;
  category?: number | null;
  subcategory?: number | null;
  model: string;
  serial_number: string;
  plate_image_url?: string | null;
  daily_working_hours: number;
  current_hour_meter?: number | null;
  location: string;
  status: MachineStatus | string;
  electrical_evaluation?: ElectricalEvaluationWritePayload | null;
}

export interface MachineListFilters {
  client_id?: number;
  brand_id?: number;
  status?: string;
}

/** Partes recomendadas por subcategoría (Core). */
export interface SubcategoryRecommendedPart {
  id: number;
  subcategory: number;
  subcategory_name?: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface SubcategoryRecommendedPartWritePayload {
  subcategory: number;
  name: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface RecommendedPartsImportResult {
  created?: number;
  updated?: number;
  failed?: number;
  errors?: { row?: number; message: string }[];
  detail?: string;
}

/** Tipos de informe de servicio. */
export type ReportType = 'EVALUATION' | 'SERVICE';
export type ReportCondition = 'OPERATIONAL' | 'INOPERATIVE';
export type PartCheckCondition = 'OK' | 'REPLACE' | 'CLEAN';

export interface ReportPartCheck {
  id?: number;
  recommended_part: number;
  recommended_part_name?: string | null;
  condition: PartCheckCondition | string;
  part_number: string | null;
  notes: string | null;
}

export interface ReportPartCheckWritePayload {
  recommended_part: number;
  condition: PartCheckCondition | string;
  part_number?: string | null;
  notes?: string | null;
}

/** Panel fotográfico del informe. */
export type ReportPhotoLabel = 'BEFORE' | 'DURING' | 'AFTER';

export interface ReportPhoto {
  id: number;
  report?: number;
  photo_url: string;
  label: ReportPhotoLabel | string;
  note: string | null;
  sort_order: number;
  created_at?: string | null;
}

export interface ReportPhotoWritePayload {
  photo_url: string;
  label: ReportPhotoLabel | string;
  note?: string | null;
  sort_order?: number;
}

/** GET/POST /api/servicios/reports/ */
export interface ServiceReport {
  id: number;
  /** Generado por backend: `{companyId}-EVA-000001` o `{companyId}-SRV-000001`. */
  correlativo: string | null;
  type: ReportType | string;
  machine: number;
  origin_report: number | null;
  intervention_date: string;
  hour_meter: number | null;
  current_condition: ReportCondition | string | null;
  work_performed: string | null;
  background: string | null;
  conclusions: string | null;
  recommendations: string | null;
  part_checks: ReportPartCheck[];
  photos: ReportPhoto[];
  /** Snapshot eléctrico del informe; al guardar actualiza también la máquina. */
  electrical_evaluation: ElectricalEvaluation | null;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ServiceReportWritePayload {
  type: ReportType | string;
  machine: number;
  origin_report?: number | null;
  intervention_date: string;
  hour_meter?: number | null;
  current_condition?: ReportCondition | string | null;
  work_performed?: string | null;
  background?: string | null;
  conclusions?: string | null;
  recommendations?: string | null;
  part_checks?: ReportPartCheckWritePayload[];
  /** Si se envía en PATCH, reemplaza todo el panel. Omitir para mantener fotos. */
  photos?: ReportPhotoWritePayload[];
  /** Omitir o null si INOPERATIVE / no midieron. */
  electrical_evaluation?: ElectricalEvaluationWritePayload | null;
}

export interface ServiceReportListFilters {
  machine_id?: number;
  type?: ReportType | string;
  intervention_date_from?: string;
  intervention_date_to?: string;
}
