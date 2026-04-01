/** Alineado con Django: AdminUserListSerializer / AdminUserWriteSerializer. */

export interface Company {
  id: number;
  name: string;
  /** URL del logo (ImageField en API) */
  logo?: string | null;
  /** Texto libre; campo `bank_accounts` en API Django */
  bank_accounts?: string;
}

export type UserRole = 'ALMACEN' | 'VENTAS' | 'LOGISTICA' | 'ADMIN';

export interface UserProfileNested {
  id: number;
  company: Company;
  quotation_prefix: string;
  role: UserRole;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  cellphone?: string;
  is_active: boolean;
  is_superuser: boolean;
  profile: UserProfileNested | null;
}

export interface AdminUserCreateRequest {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  cellphone?: string;
  is_active?: boolean;
  company_id?: number;
  role?: UserRole;
  quotation_prefix?: string;
}

export type AdminUserUpdateRequest = Partial<Omit<AdminUserCreateRequest, 'username'>>;

export interface AdminSetPasswordBody {
  password: string;
}

/** Alias para desplegables (mismo shape que Company). */
export type CompanyOption = Company;
