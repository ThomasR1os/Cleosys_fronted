import type {
  QuotationMoney,
  QuotationRow,
  QuotationStatus,
  QuotationType,
} from '../../ventas/models/ventas.models';

export type ReportGrouping = 'day' | 'month' | 'year';

export type DashboardDatePreset =
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'all'
  | 'custom';

export interface DashboardFilters {
  grouping: ReportGrouping;
  datePreset: DashboardDatePreset;
  dateFrom: string;
  dateTo: string;
  status: 'ALL' | QuotationStatus;
  quotationType: 'ALL' | QuotationType;
  money: 'ALL' | QuotationMoney;
  advisorId: number | 'ALL';
}

export interface DashboardKpis {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  approvalRate: number;
  totalAmountPen: number;
  totalAmountUsd: number;
  avgAmountPen: number;
  avgAmountUsd: number;
}

export interface TimeBucket {
  key: string;
  label: string;
  count: number;
  amountPen: number;
  amountUsd: number;
}

export interface StatusBucket {
  status: QuotationStatus;
  label: string;
  count: number;
}

export interface TypeBucket {
  type: QuotationType;
  label: string;
  count: number;
}

export interface AdvisorBucket {
  id: number;
  label: string;
  count: number;
  amountPen: number;
  amountUsd: number;
}

export interface DashboardStats {
  filtered: QuotationRow[];
  kpis: DashboardKpis;
  timeSeries: TimeBucket[];
  byStatus: StatusBucket[];
  byType: TypeBucket[];
  byAdvisor: AdvisorBucket[];
  advisors: { id: number; label: string }[];
}
