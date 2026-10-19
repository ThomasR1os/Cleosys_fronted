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

/** Cartera comercial anidada en lookup / cliente. */
export interface ClientPortfolio {
  id: number;
  sales_owner?: number | ClientLookupSalesUser | null;
  sales_owner_name?: string | null;
  status?: string | null;
  assignment_source?: string | null;
  assigned_at?: string | null;
}

/** GET /api/clients/lookup-by-ruc/ */
export interface ClientLookupByRucResponse {
  exists: boolean;
  client: ClientRow | null;
  sales_summary: ClientLookupSalesSummary | null;
  contacts: ClientLookupContactItem[];
  portfolio?: ClientPortfolio | null;
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
export type ProformaPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type ProformaWorkflowStatus =
  | 'DRAFT'
  | 'PENDING_SALES'
  | 'STOCK_REVIEW'
  | 'PENDING_LOGISTICS'
  | 'WAITING_SALES_INFORMATION'
  | 'WAITING_SUPPLIER'
  | 'LOGISTICS_PROCESSING'
  | 'PENDING_SALES_REVIEW'
  | 'QUOTATION_READY'
  | 'NOT_POSSIBLE'
  | 'COMPLETED'
  | 'CANCELLED';
export type TaskQueue = 'MARKETING' | 'SALES' | 'LOGISTICS' | 'WAREHOUSE' | 'SERVICES' | 'ADMIN';
export type WaitingOn = 'NONE' | 'MARKETING' | 'SALES' | 'LOGISTICS' | 'SUPPLIER' | 'CLIENT';
export type ItemAvailabilityStatus =
  | 'PENDING_REVIEW'
  | 'IN_STOCK'
  | 'LOCAL_PURCHASE'
  | 'IMPORT_REQUIRED'
  | 'NOT_FOUND'
  | 'NOT_POSSIBLE';

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
  sales_owner?: number | null;
  sales_owner_detail?: ProformaAssignedUserDetail | null;
  logistics_owner?: number | null;
  logistics_owner_detail?: ProformaAssignedUserDetail | null;
  created_by_detail?: ProformaAssignedUserDetail | null;
  entry_channel: ProformaEntryChannel;
  proforma_type: ProformaRequestType;
  /** Estado comercial (`PENDIENTE` por defecto al crear). */
  status?: ProformaRequestStatus;
  /** Estado operativo del flujo. No se cambia con PATCH. */
  workflow_status?: ProformaWorkflowStatus | null;
  priority?: ProformaPriority | null;
  due_at?: string | null;
  task_queue?: TaskQueue | null;
  waiting_on?: WaitingOn | null;
  correlativo?: string | null;
  task_id?: number | null;
  task_correlativo?: string | null;
  description: string;
  quotation: number | null;
  quotation_correlativo?: string | null;
  /** Solo lectura: momento de ingreso del requerimiento (ISO 8601). */
  entered_at?: string | null;
  /** Solo lectura: momento en que se vinculó cotización; null si no hay. */
  quoted_at?: string | null;
  updated_at?: string | null;
  last_moved_at?: string | null;
  /** Orden interna creada al aprobar. Solo lectura. */
  logistics_order_id?: number | null;
  company_client_detail?: ClientPortfolio | null;
  request_items?: ProformaRequestItem[];
  clarifications?: ProformaClarification[];
  supplier_offers?: SupplierOffer[];
}

export interface ProformaRequestItemPayload {
  requested_sku?: string;
  description: string;
  quantity: string;
  requested_unit?: string;
  availability_status?: ItemAvailabilityStatus;
  requires_sourcing?: boolean;
  product?: number | null;
}

export interface ProformaRequestItem {
  id: number;
  proforma_request: number;
  requested_sku?: string | null;
  description: string;
  quantity: string | number;
  requested_unit?: string | null;
  availability_status?: ItemAvailabilityStatus | null;
  requires_sourcing?: boolean;
  product?: number | null;
}

export interface ProformaClarification {
  id: number;
  proforma_request: number;
  item?: number | null;
  question: string;
  answer?: string | null;
  asked_by_detail?: ProformaAssignedUserDetail | null;
  answered_by_detail?: ProformaAssignedUserDetail | null;
  created_at?: string | null;
  answered_at?: string | null;
}

export interface SupplierOfferItem {
  id: number;
  supplier_offer?: number;
  proforma_request_item: number;
  product: number;
  supplier_part_number?: string | null;
  unit_cost: string;
  sale_unit_price: string;
  includes_tax?: boolean;
  estimated_lead_time_days?: number | null;
  warranty?: string | null;
  available_locally?: boolean;
  selected?: boolean;
  product_detail?: { id: number; sku?: string; description?: string } | null;
}

export interface SupplierOffer {
  id: number;
  proforma_request: number;
  supplier: number;
  supplier_detail?: { id: number; name: string; ruc?: string } | null;
  money?: 'PEN' | 'USD' | null;
  exchange_rate?: string | number | null;
  payment_methods?: number | null;
  /** Texto legado, si el backend aún lo devuelve. */
  payment_terms?: string | null;
  incoterm?: string | null;
  valid_until?: string | null;
  attachment_url?: string | null;
  items?: SupplierOfferItem[];
  created_at?: string | null;
}

export interface SupplierOfferItemWrite {
  proforma_request_item: number;
  product: number;
  supplier_part_number?: string;
  unit_cost: string;
  sale_unit_price: string;
  includes_tax?: boolean;
  estimated_lead_time_days?: number | null;
  warranty?: string;
  available_locally?: boolean;
  selected?: boolean;
}

export interface SupplierOfferCreatePayload {
  proforma_request: number;
  supplier: number;
  money?: 'PEN' | 'USD';
  exchange_rate?: string | null;
  payment_methods: number;
  incoterm?: string;
  valid_until?: string | null;
  attachment_url?: string;
  items: SupplierOfferItemWrite[];
}

export interface GenerateQuotationPayload {
  payment_methods: number;
  discount?: string;
  conditions?: string;
  works?: string;
  see_sku?: boolean;
  rental_unit?: RentalUnit | null;
  rental_quantity?: number | null;
}

export interface ProformaRequestCreatePayload {
  client: number;
  assigned_user?: number;
  entry_channel: ProformaEntryChannel;
  proforma_type: ProformaRequestType;
  description: string;
  priority?: ProformaPriority;
  due_at?: string | null;
  request_items?: ProformaRequestItemPayload[];
  /** Opcional: el servidor usa `PENDIENTE` si no se envía. */
  status?: ProformaRequestStatus;
  quotation?: number | null;
}

/** Línea vendida al aprobar. No modifica la cotización. */
export interface ProformaSoldItem {
  /** Id de la línea de cotización (`quotation-products`). */
  quotation_product: number;
  /** Cantidad que pidió el cliente. Entero de 1 para arriba. */
  cant: number;
}

export interface ProformaRequestPatchPayload {
  client?: number;
  assigned_user?: number;
  entry_channel?: ProformaEntryChannel;
  proforma_type?: ProformaRequestType;
  status?: ProformaRequestStatus;
  description?: string;
  quotation?: number | null;
  priority?: ProformaPriority;
  due_at?: string | null;
  /**
   * Solo junto con `status: APROBADA`. Lo que no va aquí no entra a la orden.
   * La cotización enviada no cambia.
   */
  sold_items?: ProformaSoldItem[];
}

export interface ProformaRequestListParams {
  mine?: boolean;
  assigned_user?: number;
  workflow_status?: ProformaWorkflowStatus;
  /** Tope de páginas DRF al listar (por defecto 25 ≈ 250 filas con page_size 10). */
  maxPages?: number;
  pageSize?: number;
}

/** GET|POST /api/ventas/proforma-requests/{id}/attachments/ */
export interface ProformaRequestAttachment {
  id: number;
  name: string;
  url: string;
  content_type: string;
}

/** Disponibilidad de un producto del catálogo. */
export type RecommendationMatchAvailability = 'STOCK' | 'IMPORTACION';

/** Resultado de una línea: hay stock, hay que importar, o no hubo coincidencia. */
export type RecommendationLineAvailability = RecommendationMatchAvailability | 'NO_ENCONTRADO';

/** Hasta 3 productos parecidos, el más parecido primero. */
export interface ProformaRecommendationMatch {
  product_id: number;
  sku: string;
  description: string;
  stock: number;
  availability: RecommendationMatchAvailability;
}

/** Una fila de lo que el modelo entendió del requerimiento. */
export interface ProformaRecommendationLine {
  requested: string;
  qty: number;
  brand: string | null;
  availability: RecommendationLineAvailability;
  /** null si hay productos. */
  message: string | null;
  matches: ProformaRecommendationMatch[];
}

/** GET|POST /api/ventas/proforma-requests/{id}/recommend/ */
export interface ProformaRecommendation {
  id: number;
  lines: ProformaRecommendationLine[];
  /** null si alguna línea encontró producto. */
  message: string | null;
  unreadable_attachments: string[];
  created_at: string;
  updated_at: string;
}

/** GET /api/ventas/proforma-requests/assignable-users/ */
export interface AssignableUser {
  /**
   * Usuario Django (`User.pk`): valor del select «Derivar a» y campo `assigned_user`
   * en POST/PATCH de solicitudes de proforma.
   */
  id: number;
  /**
   * Id de perfil/ítem en assignable-users cuando el API lo separa de `id`.
   * Se envía como `owner` en contactos si difiere de `id`.
   */
  profileId?: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
}

export type QuotationType = 'VENTA' | 'ALQUILER' | 'SERVICIO';
export type QuotationMoney = 'USD' | 'PEN';
export type QuotationStatus = 'APROBADA' | 'PENDIENTE' | 'RECHAZADA';

/** GET /api/ventas/quotations/?client=<id>&summary=1 */
export interface QuotationSummary {
  id: number;
  correlativo: string;
  status: QuotationStatus;
  client: number;
  final_price: string;
}

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
  /** Texto libre (p. ej. «15 días hábiles»). Principal en SERVICIO; en VENTA/ALQUILER puede ir vacío. */
  delivery_time: string;
  /** Texto libre o null. */
  conditions: string | null;
  payment_methods: number;
  /** Servicio técnico; texto o null. */
  works: string | null;
  see_sku: boolean;
  creation_date?: string;
  update_date?: string;
  /** Fecha en que pasó a APROBADA, si el backend la expone. */
  approved_at?: string | null;
  /** Orden interna creada al aprobar. Solo lectura. */
  logistics_order_id?: number | null;
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
  /** Plazo por línea (VENTA/ALQUILER). Opcional en SERVICIO. */
  delivery_time?: string | null;
  /** Garantía editable por línea; si vacío, el backend puede copiar del catálogo. */
  line_warranty?: string | null;
}

export interface PaymentMethodRow {
  id: number;
  name: string;
}

/** POST /api/ventas/quotations/{id}/send-email/ */
export interface QuotationSendEmailRequest {
  to?: string[];
  cc?: string[];
  subject?: string;
  /** Versión texto plano del cuerpo. */
  message?: string;
  /**
   * Versión HTML. Las imágenes de firma deben usar src="cid:…" (el backend las adjunta inline).
   */
  html_message?: string;
  /** URL de firma del remitente; el backend la descarga y la incrusta con CID, no como URL en el HTML. */
  signature_url?: string | null;
  pdf_base64: string;
  pdf_filename: string;
}

export interface QuotationSendEmailResponse {
  status: string;
  to: string[];
  cc: string[];
  log_id?: number;
}
