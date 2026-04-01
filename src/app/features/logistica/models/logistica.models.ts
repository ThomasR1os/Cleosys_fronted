export interface LogisticTask {
  id: number;
  name: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ProductSupplierMoney = 'USD' | 'PEN';

export interface ProductSupplierRow {
  id: number;
  money: ProductSupplierMoney;
  product: number;
  supplier: number;
  cost: string;
  incoterm: string;
  creation_date?: string;
}
