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
  /** Si la API lo devuelve (dirección fiscal o de entrega). */
  address?: string;
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

/**
 * Asesor anidado en cotizaciones (`user_detail`).
 * `QuotationSerializer` / detalle de usuario: nombre para UI; email y cellphone según permisos (p. ej. PDF).
 */
export interface QuotationUserDetail {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  /** Texto listo para UI: nombre apellido, o username, o id. */
  nombre: string;
  email?: string | null;
  cellphone?: string | null;
}

/**
 * Contacto del cliente anidado en cotización (`client_contact_detail`, solo lectura).
 * `nombre` siempre; `email` y `phone` pueden ser null (misma regla que `GET /ventas/client-contacts/`).
 */
export interface QuotationClientContactDetail {
  id: number;
  contact_first_name: string;
  contact_last_name: string;
  nombre: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Recurso cotización: `GET|POST /api/ventas/quotations/`, `GET|PATCH|PUT|DELETE /api/ventas/quotations/{id}/`.
 * JSON producido por `QuotationSerializer` (ventas/serializers.py).
 */
export interface QuotationRow {
  id: number;
  quotation_type: QuotationType;
  money: QuotationMoney;
  /** PEN por 1 USD o null si no aplica. */
  exchange_rate?: string | number | null;
  status: QuotationStatus;
  /** FK a `core.Client`. */
  client: number;
  /** FK opcional a contacto del cliente; escritura en POST/PATCH. */
  client_contact?: number | null;
  /** Solo lectura: anidado desde serializer; null si no hay contacto. */
  client_contact_detail?: QuotationClientContactDetail | null;
  /** FK al usuario asesor/creador. */
  user: number;
  /** Asesor anidado (PDF, listado). */
  user_detail?: QuotationUserDetail | null;
  /** Generado en servidor; solo lectura en API. */
  correlativo: string;
  /** Importes como string decimal típico de DRF. */
  discount: string;
  final_price: string;
  delivery_time: number;
  /** Texto libre o null. */
  conditions: string | null;
  payment_methods: number;
  /** Alcance / trabajos; texto o null. */
  works: string | null;
  see_sku: boolean;
  creation_date?: string;
  update_date?: string;
  /** Empresa emisora si el backend expone FK (p. ej. branding PDF). */
  company?: number;
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
