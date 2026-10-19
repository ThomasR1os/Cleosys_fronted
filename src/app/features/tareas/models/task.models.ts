import type { ProformaAssignedUserDetail, TaskQueue, WaitingOn } from '../../ventas/models/ventas.models';

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'WAITING' | 'COMPLETED' | 'CANCELLED' | 'NOT_POSSIBLE';

export interface TaskSummary {
  assigned_to_me: number;
  waiting_supplier: number;
  pending_sales: number;
  unassigned: number;
  overdue: number;
}

export interface TaskEvent {
  id?: number;
  title?: string;
  description?: string;
  created_at?: string | null;
  actor_detail?: ProformaAssignedUserDetail | null;
}

export interface TaskComment {
  id: number;
  body: string;
  created_at?: string | null;
  user_detail?: ProformaAssignedUserDetail | null;
}

export interface TaskRow {
  id: number;
  correlativo?: string | null;
  status?: TaskStatus | null;
  queue?: TaskQueue | null;
  waiting_on?: WaitingOn | null;
  assigned_user?: number | null;
  assigned_user_detail?: ProformaAssignedUserDetail | null;
  proforma_request?: number | null;
  proforma_correlativo?: string | null;
  title?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assignments?: unknown[];
  events?: TaskEvent[];
  comments?: TaskComment[];
}

export interface TaskListParams {
  mine?: boolean;
  unassigned?: boolean;
  status?: TaskStatus;
  queue?: TaskQueue;
  assigned_user?: number;
  proforma_request?: number;
}
