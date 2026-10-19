import type {
  ItemAvailabilityStatus,
  ProformaPriority,
  ProformaRequestRow,
  ProformaWorkflowStatus,
  TaskQueue,
  WaitingOn,
} from '../models/ventas.models';

export const WORKFLOW_STATUSES: ProformaWorkflowStatus[] = [
  'DRAFT',
  'PENDING_SALES',
  'STOCK_REVIEW',
  'PENDING_LOGISTICS',
  'WAITING_SALES_INFORMATION',
  'WAITING_SUPPLIER',
  'LOGISTICS_PROCESSING',
  'PENDING_SALES_REVIEW',
  'QUOTATION_READY',
  'NOT_POSSIBLE',
  'COMPLETED',
  'CANCELLED',
];

export const TASK_QUEUES: TaskQueue[] = [
  'MARKETING',
  'SALES',
  'LOGISTICS',
  'WAREHOUSE',
  'SERVICES',
  'ADMIN',
];

export const WAITING_ON_VALUES: WaitingOn[] = [
  'NONE',
  'MARKETING',
  'SALES',
  'LOGISTICS',
  'SUPPLIER',
  'CLIENT',
];

export function workflowLabel(status: ProformaWorkflowStatus | null | undefined): string {
  const labels: Record<ProformaWorkflowStatus, string> = {
    DRAFT: 'Borrador',
    PENDING_SALES: 'Pendiente de ventas',
    STOCK_REVIEW: 'Revisión de stock',
    PENDING_LOGISTICS: 'Pendiente de logística',
    WAITING_SALES_INFORMATION: 'Falta información',
    WAITING_SUPPLIER: 'Esperando proveedor',
    LOGISTICS_PROCESSING: 'Procesando respuesta',
    PENDING_SALES_REVIEW: 'Revisar cotización',
    QUOTATION_READY: 'Cotización lista',
    NOT_POSSIBLE: 'No es posible',
    COMPLETED: 'Finalizada',
    CANCELLED: 'Cancelada',
  };
  return status ? labels[status] : '—';
}

export function workflowBadgeClass(status: ProformaWorkflowStatus | null | undefined): string {
  switch (status) {
    case 'DRAFT':
    case 'PENDING_SALES':
    case 'STOCK_REVIEW':
      return 'badge-warning';
    case 'PENDING_LOGISTICS':
    case 'LOGISTICS_PROCESSING':
      return 'badge-primary';
    case 'WAITING_SALES_INFORMATION':
      return 'badge-info';
    case 'WAITING_SUPPLIER':
      return 'badge-warning';
    case 'PENDING_SALES_REVIEW':
    case 'QUOTATION_READY':
    case 'COMPLETED':
      return 'badge-success';
    case 'NOT_POSSIBLE':
    case 'CANCELLED':
      return 'badge-error';
    default:
      return 'badge-ghost border border-base-300';
  }
}

export function queueLabel(queue: TaskQueue | null | undefined): string {
  const labels: Record<TaskQueue, string> = {
    MARKETING: 'Marketing',
    SALES: 'Ventas',
    LOGISTICS: 'Logística',
    WAREHOUSE: 'Almacén',
    SERVICES: 'Servicios',
    ADMIN: 'Admin',
  };
  return queue ? labels[queue] : '—';
}

export function waitingOnLabel(value: WaitingOn | null | undefined): string {
  const labels: Record<WaitingOn, string> = {
    NONE: '—',
    MARKETING: 'Marketing',
    SALES: 'Ventas',
    LOGISTICS: 'Logística',
    SUPPLIER: 'Proveedor',
    CLIENT: 'Cliente',
  };
  return value ? labels[value] : '—';
}

export function priorityLabel(value: ProformaPriority | null | undefined): string {
  if (value === 'HIGH') return 'Alta';
  if (value === 'LOW') return 'Baja';
  if (value === 'NORMAL') return 'Normal';
  return '—';
}

export function availabilityLabel(value: ItemAvailabilityStatus | null | undefined): string {
  const labels: Record<ItemAvailabilityStatus, string> = {
    PENDING_REVIEW: 'Por revisar',
    IN_STOCK: 'En stock',
    LOCAL_PURCHASE: 'Compra local',
    IMPORT_REQUIRED: 'Importación',
    NOT_FOUND: 'No encontrado',
    NOT_POSSIBLE: 'No es posible',
  };
  return value ? labels[value] : '—';
}

export function requestCode(row: Pick<ProformaRequestRow, 'id' | 'correlativo'>): string {
  const code = row.correlativo?.trim();
  return code || `SP-${String(row.id).padStart(6, '0')}`;
}

export function taskCode(row: Pick<ProformaRequestRow, 'id' | 'task_correlativo'>): string | null {
  const code = row.task_correlativo?.trim();
  return code || null;
}

export function effectiveWorkflow(row: ProformaRequestRow): ProformaWorkflowStatus {
  if (row.workflow_status) return row.workflow_status;
  // Registros previos al flujo operativo: estados comerciales cerrados → finalizada.
  if (row.status === 'APROBADA' || row.status === 'RECHAZADA' || row.status === 'SIN_RESPUESTA') {
    return 'COMPLETED';
  }
  if (row.quotation != null) return 'QUOTATION_READY';
  return 'PENDING_SALES';
}

export function isClosedWorkflow(status: ProformaWorkflowStatus | null | undefined): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export function isWaitingWorkflow(status: ProformaWorkflowStatus | null | undefined): boolean {
  return (
    status === 'WAITING_SUPPLIER' ||
    status === 'WAITING_SALES_INFORMATION' ||
    status === 'PENDING_LOGISTICS' ||
    status === 'LOGISTICS_PROCESSING'
  );
}

export function userDisplayName(
  detail: { nombre?: string; first_name?: string; last_name?: string; username?: string } | null | undefined,
  fallbackId?: number | null,
): string {
  if (detail?.nombre?.trim()) return detail.nombre.trim();
  const full = [detail?.first_name, detail?.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (detail?.username) return detail.username;
  if (fallbackId != null && fallbackId > 0) return `Usuario #${fallbackId}`;
  return 'Sin asignar';
}

export function dueIsOverdue(dueAt: string | null | undefined, workflow?: ProformaWorkflowStatus | null): boolean {
  if (!dueAt || isClosedWorkflow(workflow)) return false;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}
