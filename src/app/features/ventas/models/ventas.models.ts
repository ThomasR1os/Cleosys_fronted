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
  /**
   * Indica si el cliente pertenece al conjunto "míos" del usuario autenticado (lo trae el backend).
   * Solo se evalúa para decidir UI (Editar/Eliminar); los permisos reales los aplica el servidor.
   * Siempre `true` en `GET /clients/` por defecto; en `GET /clients/?scope=company` puede ser `false`.
   */
  is_mine?: boolean;
}

/**
 * POST /clients/: contacto inicial obligatorio.
 * No incluir `user`/`owner` aquí: asignar encargado vía PATCH /ventas/client-contacts/.
 */
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

/** GET/POST /api/sunat/ruc/identificacion/ */
export interface SunatRucIdentificacion {
  ruc: string;
  razon_social: string;
}

/** Usuario asignado en ítem de GET /clients/lookup-by-ruc/ (contactos). */
export interface ClientLookupAssignedUserDetail {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
}

/** Contacto en respuesta de lookup-by-ruc (empresa). */
export interface ClientLookupContactItem {
  id: number;
  contact_first_name: string;
  contact_last_name: string;
  nombre: string;
  email?: string | null;
  phone?: string | null;
  assigned_user: ClientLookupAssignedUserDetail | null;
}

/** Asesor en resumen comercial del lookup-by-ruc. */
export interface ClientLookupSalesUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
}

export interface ClientLookupSalesSummary {
  message_for_ui: string;
  primary_sales_user: ClientLookupSalesUser | null;
  other_sales_users: ClientLookupSalesUser[];
  contacts_count: number;
}

/** GET /api/clients/lookup-by-ruc/ */
export interface ClientLookupByRucResponse {
  exists: boolean;
  client: ClientRow | null;
  sales_summary: ClientLookupSalesSummary | null;
  contacts: ClientLookupContactItem[];
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

/** POST /api/ventas/client-contacts/ (campos típicos del serializer). */
export interface ClientContactCreatePayload {
  client: number;
  contact_first_name: string;
  contact_last_name: string;
  email?: string | null;
  phone?: string | null;
  /** Vendedor asignado al contacto (opcional según backend). */
  user?: number | null;
  owner?: number | null;
}

/** PATCH /api/ventas/client-contacts/{id}/ */
export interface ClientContactPatchPayload {
  contact_first_name?: string;
  contact_last_name?: string;
  email?: string | null;
  phone?: string | null;
  user?: number | null;
  owner?: number | null;
}

export type ProformaEntryChannel = 'META' | 'GOOGLE_ADS' | 'WHATSAPP' | 'EMAIL';
export type ProformaRequestType = 'MAQUINARIA' | 'REPUESTOS' | 'SERVICIOS' | 'ALQUILERES';
export type ProformaRequestStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'SIN_RESPUESTA';

/** Cliente anidado en solicitud de proforma (solo lectura). */
export interface ProformaClientDetail {
  id: number;
  ruc: string;
  name: string;
}

/** Usuario asignado en solicitud de proforma (`assigned_user_detail`). */
export interface ProformaAssignedUserDetail {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
}

/** GET|POST|PATCH /api/ventas/proforma-requests/ */
export interface ProformaRequestRow {
  id: number;
  company: number;
  client: number;
  client_detail?: ProformaClientDetail | null;
  assigned_user: number;
  assigned_user_detail?: ProformaAssignedUserDetail | null;
  entry_channel: ProformaEntryChannel;
  proforma_type: ProformaRequestType;
  /** Estado de respuesta al requerimiento (`PENDIENTE` por defecto al crear). */
  status?: ProformaRequestStatus;
  description: string;
  quotation: number | null;
  quotation_correlativo?: string | null;
  /** Solo lectura: momento de ingreso del requerimiento (ISO 8601). */
  entered_at?: string | null;
  /** Solo lectura: momento en que se vinculó cotización; null si no hay. */
  quoted_at?: string | null;
}

export interface ProformaRequestCreatePayload {
  client: number;
  assigned_user: number;
  entry_channel: ProformaEntryChannel;
  proforma_type: ProformaRequestType;
  description: string;
  /** Opcional: el servidor usa `PENDIENTE` si no se envía. */
  status?: ProformaRequestStatus;
  quotation?: number | null;
}

export interface ProformaRequestPatchPayload {
  client?: number;
  assigned_user?: number;
  entry_channel?: ProformaEntryChannel;
  proforma_type?: ProformaRequestType;
  status?: ProformaRequestStatus;
  description?: string;
  quotation?: number | null;
}

/** GET /api/ventas/proforma-requests/assignable-users/ */
export interface AssignableUser {
  /** Django User pk (`contact.user`, proforma `assigned_user`). */
  id: number;
  /** UserProfile pk si el listado trae `id` de perfil y `user` numérico u objeto. */
  profileId?: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
}

export type QuotationType = 'VENTA' | 'ALQUILER' | 'SERVICIO';
export type QuotationMoney = 'USD' | 'PEN';
export type QuotationStatus = 'APROBADA' | 'PENDIENTE' | 'RECHAZADA';
/** Modalidad de alquiler: días o mes. Solo aplica cuando quotation_type === 'ALQUILER'. */
export type RentalUnit = 'DIAS' | 'MES';

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
 * Cliente anidado en cotización (`client_detail`, solo lectura).
 * Permite mostrar el nombre del cliente en tabla / vista aun cuando el listado
 * `GET /clients/` esté acotado al vendedor (no incluye clientes ajenos).
 */
export interface QuotationClientDetail {
  id: number;
  name: string;
  ruc?: string;
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
  /** Solo aplica cuando quotation_type === 'ALQUILER'; null en VENTA/SERVICIO. */
  rental_unit?: RentalUnit | null;
  /** Cantidad de días o meses; obligatorio (>=1) cuando quotation_type === 'ALQUILER'. */
  rental_quantity?: number | null;
  status: QuotationStatus;
  /** FK a `core.Client`. */
  client: number;
  /** Solo lectura: cliente anidado desde serializer (para mostrar nombre/RUC en listado). */
  client_detail?: QuotationClientDetail | null;
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
  /** Servicio técnico; texto o null. */
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
