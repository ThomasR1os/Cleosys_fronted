import type {
  QuotationMoney,
  QuotationRow,
  QuotationStatus,
  QuotationType,
} from '../../ventas/models/ventas.models';

export interface DashboardFilters {
  year: number;
  /** 1–12, o todo el año. */
  month: number | 'ALL';
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
  years: number[];
}
