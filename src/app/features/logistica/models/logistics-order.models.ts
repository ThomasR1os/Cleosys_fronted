/** Estados de `/api/logistica/logistics-orders/`. */
export type LogisticsOrderStatus = 'PENDIENTE' | 'PARCIAL' | 'COMPRADA' | 'CERRADA';

export const LOGISTICS_ORDER_STATUSES: { value: LogisticsOrderStatus; label: string }[] = [
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'COMPRADA', label: 'Comprada' },
  { value: 'CERRADA', label: 'Cerrada' },
];

/** Clave de `history.state` al abrir el alta de OC desde una orden interna. */
export const LOGISTICS_PURCHASE_STATE = 'logisticsOrderPurchase';

export interface LogisticsOrder {
  id: number;
  status: LogisticsOrderStatus;
  notes: string;
  quotation: number | null;
  quotation_correlativo: string | null;
  client: number | null;
  client_name: string | null;
  created_at: string | null;
  /** Presente solo si el listado ya trae las líneas. */
  items?: LogisticsOrderItem[];
}

export interface LogisticsOrderItem {
  id: number;
  logistics_order: number;
  product: number;
  product_sku: string;
  product_description: string;
  /** Lo que pidió el cliente al aprobar. */
  cant: string;
  /** Lo cotizado. La cotización no cambia al aprobar. */
  quoted_cant: string | null;
  ordered_qty: string;
  pending_qty: string;
}

export interface LogisticsOrderListQuery {
  status?: LogisticsOrderStatus | null;
  quotation?: number | null;
  client?: number | null;
}

export interface LogisticsOrderPatch {
  status: LogisticsOrderStatus;
  notes: string;
}

/** Línea que el editor de OC recibe para cubrir lo pendiente. */
export interface LogisticsPurchaseDraftLine {
  logistics_order_item: number;
  product: number;
  cant: string;
  sku: string;
  description: string;
}

export interface LogisticsPurchaseDraft {
  logisticsOrderId: number;
  lines: LogisticsPurchaseDraftLine[];
}

export function logisticsOrderStatusLabel(status: string): string {
  return LOGISTICS_ORDER_STATUSES.find((opt) => opt.value === status)?.label ?? status;
}

export function logisticsOrderStatusBadge(status: string): string {
  switch (status) {
    case 'PENDIENTE':
      return 'badge-warning';
    case 'PARCIAL':
      return 'badge-info';
    case 'COMPRADA':
      return 'badge-success';
    case 'CERRADA':
      return 'badge-ghost';
    default:
      return 'badge-ghost';
  }
}

export function logisticsOrderIdByQuotation(orders: LogisticsOrder[]): Record<number, number> {
  const map: Record<number, number> = {};
  for (const order of orders) {
    if (order.quotation == null || order.quotation <= 0) continue;
    const prev = map[order.quotation];
    if (prev == null || order.id > prev) map[order.quotation] = order.id;
  }
  return map;
}

export function sumPendingQty(items: { pending_qty: string }[]): number {
  return items.reduce((sum, item) => sum + Number(item.pending_qty || 0), 0);
}

export function formatQty(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function logisticsItemLabel(item: {
  product: number;
  product_sku: string;
  product_description: string;
}): string {
  const text = [item.product_sku, item.product_description].filter((part) => part.trim()).join(' — ');
  return text || `Producto #${item.product}`;
}

export function readLogisticsPurchaseDraft(): LogisticsPurchaseDraft | null {
  const state = history.state as Record<string, unknown> | null;
  const raw = state?.[LOGISTICS_PURCHASE_STATE];
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as Partial<LogisticsPurchaseDraft>;
  const logisticsOrderId = Number(draft.logisticsOrderId);
  if (!Number.isFinite(logisticsOrderId) || logisticsOrderId <= 0) return null;
  if (!Array.isArray(draft.lines) || draft.lines.length === 0) return null;
  const lines: LogisticsPurchaseDraftLine[] = [];
  for (const line of draft.lines) {
    if (!line || typeof line !== 'object') continue;
    const row = line as Partial<LogisticsPurchaseDraftLine>;
    const itemId = Number(row.logistics_order_item);
    const product = Number(row.product);
    if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(product) || product <= 0) continue;
    lines.push({
      logistics_order_item: itemId,
      product,
      cant: String(row.cant ?? '0'),
      sku: String(row.sku ?? ''),
      description: String(row.description ?? ''),
    });
  }
  if (!lines.length) return null;
  return { logisticsOrderId, lines };
}

export function normalizeLogisticsOrder(raw: unknown): LogisticsOrder {
  const row = asRecord(raw);
  const quotation = nested(row['quotation']) ?? nested(row['quotation_detail']);
  const client = nested(row['client']) ?? nested(row['client_detail']);
  const id = asNumber(row['id']) ?? 0;
  const rawItems = row['items'];
  return {
    id,
    status: asStatus(row['status']),
    notes: asText(row['notes']),
    quotation: asNumber(row['quotation']),
    quotation_correlativo:
      asText(row['quotation_correlativo']) || asText(quotation?.['correlativo']) || null,
    client: asNumber(row['client']),
    client_name: asText(row['client_name']) || asText(client?.['name']) || null,
    created_at: asText(row['created_at']) || asText(row['creation_date']) || null,
    items: Array.isArray(rawItems)
      ? rawItems.map((item) => normalizeLogisticsOrderItem(item, id)).filter((item) => item.id > 0)
      : undefined,
  };
}

export function normalizeLogisticsOrderItem(raw: unknown, logisticsOrderId = 0): LogisticsOrderItem {
  const row = asRecord(raw);
  const product = nested(row['product']) ?? nested(row['product_detail']);
  return {
    id: asNumber(row['id']) ?? 0,
    logistics_order: asNumber(row['logistics_order']) ?? logisticsOrderId,
    product: asNumber(row['product']) ?? asNumber(product?.['id']) ?? 0,
    product_sku:
      asText(row['product_sku']) ||
      asText(row['line_sku']) ||
      asText(row['sku']) ||
      asText(product?.['sku']),
    product_description:
      asText(row['product_description']) ||
      asText(row['line_description']) ||
      asText(row['description']) ||
      asText(product?.['description']),
    cant: asDecimal(row['cant']),
    quoted_cant:
      row['quoted_cant'] == null || row['quoted_cant'] === '' ? null : asDecimal(row['quoted_cant']),
    ordered_qty: asDecimal(row['ordered_qty']),
    pending_qty: asDecimal(row['pending_qty']),
  };
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return nested(value) ?? {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  const nested = asRecord(value);
  if (typeof nested['id'] === 'number') return nested['id'];
  return null;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asDecimal(value: unknown): string {
  if (value == null || value === '') return '0.00';
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function asStatus(value: unknown): LogisticsOrderStatus {
  const text = asText(value);
  if (text === 'PARCIAL' || text === 'COMPRADA' || text === 'CERRADA' || text === 'PENDIENTE') return text;
  return 'PENDIENTE';
}
