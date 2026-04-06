/** Anidado en GET/POST/PATCH /clients/ (ClientSerializer). */
export interface ClientOwnerUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** GET/PATCH /clients/ — sin dueño de ficha; los vendedores se asignan por contacto. */
export interface ClientRow {
  id: number;
  ruc: string;
  name: string;
}

/** POST /clients/: cuerpo `contact` obligatorio. */
export interface ClientContactPayload {
  contact_first_name: string;
  contact_last_name: string;
  email?: string;
  phone?: string;
}

export interface ClientCreatePayload {
  ruc: string;
  name: string;
  contact: ClientContactPayload;
}

/** Objeto `encargado` en GET /ventas/client-contacts/ (nombre preformateado en el backend). */
export interface ClientContactEncargado {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  /** first_name + last_name, o username, o fallback a id (según API). */
  nombre?: string;
}

/**
 * GET /ventas/client-contacts/
 *
 * Email/teléfono se gobiernan **por contacto**: el vendedor asignado a ese contacto (y administradores) pueden verlos.
 */
export interface ClientContactRow {
  id: number;
  client: number;
  contact_first_name: string;
  contact_last_name: string;
  email?: string | null;
  phone?: string | null;
  client_detail?: { id: number; name: string; ruc?: string };
  /** Vendedor asignado al contacto (id). Permisos de ver email/teléfono. */
  user?: number | null;
  /** Datos legibles del vendedor / encargado del contacto. */
  owner_user?: ClientOwnerUser | null;
  /** Encargado anidado (preferir `nombre` para mostrar en UI). */
  encargado?: ClientContactEncargado | null;
  /** Si el serializer usa otro nombre para el FK de usuario. */
  owner?: number | null;
  /** Opcional: ids adicionales con permiso de ver datos sensibles (si el backend lo expone). */
  users_with_access?: number[];
}

export type QuotationType = 'VENTA' | 'ALQUILER' | 'SERVICIO';
export type QuotationMoney = 'USD' | 'PEN';
export type QuotationStatus = 'APROBADA' | 'PENDIENTE' | 'RECHAZADA';

export interface QuotationRow {
  id: number;
  quotation_type: QuotationType;
  money: QuotationMoney;
  status: QuotationStatus;
  client: number;
  user: number;
  correlativo: string;
  discount: string;
  final_price: string;
  delivery_time: number;
  conditions: string;
  payment_methods: number;
  works: string;
  see_sku: boolean;
  /** Tipo de cambio PEN por 1 USD (si el backend lo expone). */
  exchange_rate?: string | number | null;
  creation_date?: string;
  update_date?: string;
}

export interface QuotationProductRow {
  id: number;
  quotation: number;
  product: number;
  cant: number;
  /** API puede devolver string decimal o número. */
  product_price: string | number;
  line_sku?: string;
  line_description?: string;
  line_datasheet?: string | null;
}

export interface PaymentMethodRow {
  id: number;
  name: string;
}
