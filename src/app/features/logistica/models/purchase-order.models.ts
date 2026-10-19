/** Estados de `/api/compras/purchase-orders/`. */
export type PurchaseOrderStatus =
  | 'BORRADOR'
  | 'ENVIADA'
  | 'CONFIRMADA'
  | 'PARCIAL'
  | 'RECIBIDA'
  | 'CANCELADA';

export type PurchaseOrderMoney = 'USD' | 'PEN';

export const PURCHASE_ORDER_STATUSES: { value: PurchaseOrderStatus; label: string }[] = [
  { value: 'BORRADOR', label: 'Borrador' },
  { value: 'ENVIADA', label: 'Enviada' },
  { value: 'CONFIRMADA', label: 'Confirmada' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'RECIBIDA', label: 'Recibida' },
  { value: 'CANCELADA', label: 'Cancelada' },
];

export interface PurchaseOrderItem {
  id: number;
  purchase_order: number;
  product: number;
  product_sku: string;
  product_description: string;
  cant: string;
  unit_cost: string;
  received_qty: string;
  line_total: string | null;
}

/** Cabecera. `items` solo viene anidado en algunas respuestas; el alta es el único POST que los guarda. */
export interface PurchaseOrder {
  id: number;
  correlativo: string;
  status: PurchaseOrderStatus;
  supplier: number;
  money: PurchaseOrderMoney;
  payment_methods: number | null;
  payment_terms: string;
  incoterm: string;
  expected_delivery_date: string | null;
  supplier_reference: string;
  warehouse: number | null;
  discount: string;
  tax: string;
  notes: string;
  subtotal: string | null;
  discount_amount: string | null;
  tax_amount: string | null;
  total: string | null;
  company: number | null;
  created_at: string | null;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderWrite {
  supplier: number;
  money: PurchaseOrderMoney;
  payment_methods: number | null;
  payment_terms: string;
  incoterm: string;
  expected_delivery_date: string | null;
  supplier_reference: string;
  warehouse: number | null;
  discount: string;
  tax: string;
  notes: string;
  status: PurchaseOrderStatus;
}

export interface PurchaseOrderCreateItem {
  product: number;
  cant: string;
  unit_cost: string;
  /** Línea de la orden interna que esta compra cubre, total o en parte. */
  logistics_order_item?: number;
}

export interface PurchaseOrderCreate extends PurchaseOrderWrite {
  items: PurchaseOrderCreateItem[];
}

export interface PurchaseOrderItemWrite {
  purchase_order: number;
  product: number;
  cant: string;
  unit_cost: string;
  received_qty?: string;
  logistics_order_item?: number;
}

export interface PurchaseOrderListQuery {
  supplier?: number | null;
  status?: PurchaseOrderStatus | null;
  correlativo?: string | null;
}

export interface PurchaseOrderTotals {
  subtotal: number;
  discountAmount: number;
  base: number;
  taxAmount: number;
  total: number;
  discountPct: number;
  taxPct: number;
  source: 'server' | 'preview';
}

export function purchaseOrderStatusLabel(status: string): string {
  return PURCHASE_ORDER_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function purchaseOrderStatusBadge(status: string): string {
  switch (status) {
    case 'ENVIADA':
      return 'badge-info';
    case 'CONFIRMADA':
      return 'badge-primary';
    case 'PARCIAL':
      return 'badge-warning';
    case 'RECIBIDA':
      return 'badge-success';
    case 'CANCELADA':
      return 'badge-error';
    default:
      return 'badge-ghost';
  }
}

export function toDecimalString(value: unknown): string {
  if (value == null || value === '') return '0.00';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0.00';
    return value.toFixed(2);
  }
  const n = Number(String(value).replace(',', '.').trim());
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export function receivedExceedsOrdered(received: unknown, cant: unknown): boolean {
  return Number(toDecimalString(received)) > Number(toDecimalString(cant));
}

export function lineAmount(cant: unknown, unitCost: unknown): number {
  const q = Number(toDecimalString(cant));
  const c = Number(toDecimalString(unitCost));
  return round2(q * c);
}

export function formatPurchaseMoney(
  amount: number | string | null | undefined,
  money: PurchaseOrderMoney,
): string {
  if (amount == null || amount === '') return '—';
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(n)) return '—';
  const num = n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return money === 'PEN' ? `S/ ${num}` : `US$ ${num}`;
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function purchaseOrderProductLabel(line: {
  product: number;
  product_sku: string;
  product_description: string;
}): string {
  const text = [line.product_sku, line.product_description].filter((p) => p.trim()).join(' — ');
  return text || `Producto #${line.product}`;
}

export function formatWarehouseLabel(
  warehouse: { id: number; address: string },
  supplierName?: string,
): string {
  const address = warehouse.address?.trim() || 'Sin dirección';
  const who = supplierName?.trim() ? ` · ${supplierName.trim()}` : '';
  return `#${warehouse.id} — ${address}${who}`;
}

export function computePurchaseOrderTotals(
  lines: { cant: unknown; unit_cost: unknown }[],
  discountPct: unknown,
  taxPct: unknown,
): Omit<PurchaseOrderTotals, 'source'> {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineAmount(line.cant, line.unit_cost), 0));
  const discount = Number(toDecimalString(discountPct));
  const tax = Number(toDecimalString(taxPct));
  const discountAmount = round2((subtotal * discount) / 100);
  const base = round2(subtotal - discountAmount);
  const taxAmount = round2((base * tax) / 100);
  return {
    subtotal,
    discountAmount,
    base,
    taxAmount,
    total: round2(base + taxAmount),
    discountPct: discount,
    taxPct: tax,
  };
}

export function resolvePurchaseOrderTotals(
  order: Pick<
    PurchaseOrder,
    'subtotal' | 'discount_amount' | 'tax_amount' | 'total' | 'discount' | 'tax'
  > | null,
  lines: { cant: unknown; unit_cost: unknown }[],
  discountPct: unknown,
  taxPct: unknown,
  useServer: boolean,
): PurchaseOrderTotals {
  const preview = computePurchaseOrderTotals(lines, discountPct, taxPct);
  if (!useServer || !order || order.total == null) {
    return { ...preview, source: 'preview' };
  }
  const subtotal = order.subtotal != null ? Number(order.subtotal) : preview.subtotal;
  const discountAmount =
    order.discount_amount != null ? Number(order.discount_amount) : preview.discountAmount;
  const taxAmount = order.tax_amount != null ? Number(order.tax_amount) : preview.taxAmount;
  return {
    subtotal,
    discountAmount,
    base: round2(subtotal - discountAmount),
    taxAmount,
    total: Number(order.total),
    discountPct: Number(toDecimalString(order.discount)),
    taxPct: Number(toDecimalString(order.tax)),
    source: 'server',
  };
}

export function enrichPurchaseOrderItems(
  items: PurchaseOrderItem[],
  products: { id: number; sku: string; description: string }[],
): PurchaseOrderItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((item) => {
    if (item.product_sku || item.product_description) return item;
    const product = byId.get(item.product);
    if (!product) return item;
    return { ...item, product_sku: product.sku, product_description: product.description };
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function fkId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const rec = asRecord(v);
  if (rec && 'id' in rec) return fkId(rec['id']);
  return null;
}

function pickDecimal(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === '') continue;
    return toDecimalString(value);
  }
  return null;
}

function asStatus(v: unknown): PurchaseOrderStatus {
  const s = String(v ?? '')
    .trim()
    .toUpperCase();
  if (PURCHASE_ORDER_STATUSES.some((x) => x.value === s)) return s as PurchaseOrderStatus;
  return 'BORRADOR';
}

function asMoney(v: unknown): PurchaseOrderMoney {
  return String(v ?? '')
    .trim()
    .toUpperCase() === 'USD'
    ? 'USD'
    : 'PEN';
}

function asDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function productInfo(row: Record<string, unknown>): { id: number; sku: string; description: string } {
  const nested =
    asRecord(row['product']) ?? asRecord(row['product_detail']) ?? asRecord(row['product_data']);
  return {
    id: fkId(row['product']) ?? fkId(row['product_id']) ?? 0,
    sku: String(row['product_sku'] ?? row['sku'] ?? row['line_sku'] ?? nested?.['sku'] ?? ''),
    description: String(
      row['product_description'] ??
        row['description'] ??
        row['line_description'] ??
        nested?.['description'] ??
        '',
    ),
  };
}

export function normalizePurchaseOrderItem(
  raw: unknown,
  parentOrderId = 0,
): PurchaseOrderItem {
  const row = asRecord(raw) ?? {};
  const product = productInfo(row);
  const cant = toDecimalString(row['cant'] ?? row['quantity'] ?? 0);
  const unitCost = toDecimalString(row['unit_cost'] ?? row['cost'] ?? 0);
  return {
    id: fkId(row['id']) ?? 0,
    purchase_order: fkId(row['purchase_order']) ?? parentOrderId,
    product: product.id,
    product_sku: product.sku,
    product_description: product.description,
    cant,
    unit_cost: unitCost,
    received_qty: toDecimalString(row['received_qty'] ?? row['received'] ?? 0),
    line_total: pickDecimal(row, ['line_total', 'line_subtotal', 'importe']),
  };
}

export function normalizePurchaseOrder(raw: unknown): PurchaseOrder {
  const row = asRecord(raw) ?? {};
  const id = fkId(row['id']) ?? 0;
  const itemsRaw = row['items'];
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.map((item) => normalizePurchaseOrderItem(item, id))
    : undefined;
  return {
    id,
    correlativo: String(row['correlativo'] ?? row['code'] ?? '').trim(),
    status: asStatus(row['status']),
    supplier: fkId(row['supplier']) ?? 0,
    money: asMoney(row['money']),
    payment_methods: fkId(row['payment_methods'] ?? row['payment_method']),
    payment_terms: String(row['payment_terms'] ?? ''),
    incoterm: String(row['incoterm'] ?? ''),
    expected_delivery_date: asDate(row['expected_delivery_date']),
    supplier_reference: String(row['supplier_reference'] ?? ''),
    warehouse: fkId(row['warehouse']),
    discount: toDecimalString(row['discount'] ?? 0),
    tax: toDecimalString(row['tax'] ?? 0),
    notes: String(row['notes'] ?? ''),
    subtotal: pickDecimal(row, ['subtotal', 'sub_total']),
    discount_amount: pickDecimal(row, ['discount_amount', 'discount_total', 'total_discount']),
    tax_amount: pickDecimal(row, ['tax_amount', 'tax_total', 'igv', 'igv_amount']),
    total: pickDecimal(row, ['total', 'grand_total', 'total_amount']),
    company: fkId(row['company']),
    created_at: row['created_at'] != null
      ? String(row['created_at'])
      : row['creation_date'] != null
        ? String(row['creation_date'])
        : row['created'] != null
          ? String(row['created'])
          : null,
    items,
  };
}
