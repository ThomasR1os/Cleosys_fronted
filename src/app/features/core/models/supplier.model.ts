export type SupplierType = 'EXTRANJERO' | 'NACIONAL';

export interface Supplier {
  id: number;
  type: SupplierType;
  ruc: string;
  name: string;
  address: string;
  contact: string;
  email: string;
  phone: string;
  bank_accounts: string;
}
