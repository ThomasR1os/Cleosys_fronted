/** Alineado con Django: AdminUserListSerializer / AdminUserWriteSerializer. */

/** Solo lectura en `CompanySerializer`; escritura vía PATCH `/companies/{id}/branding/`. */
export interface CompanyBranding {
  primary: string;
  primary_light: string;
  muted: string;
  border: string;
  table_stripe: string;
  emphasis_bar: string;
  text_body: string;
  text_label: string;
  text_caption: string;
  extensions?: Record<string, unknown>;
}

export interface Company {
  id: number;
  /** Campo `ruc` en tabla/API company (antes de `name` en el modelo Django). */
  ruc?: string;
  name: string;
  /** PDF / datos fiscales (si el backend los expone). */
  legal_name?: string;
  address?: string;
  district?: string;
  /** URL del logo (ImageField en API) */
  logo?: string | null;
  /** Texto libre; campo `bank_accounts` en API Django */
  bank_accounts?: string;
  /** Paleta PDF/documentos (API anida `branding` o defaults si no hay fila). */
  branding?: CompanyBranding;
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
