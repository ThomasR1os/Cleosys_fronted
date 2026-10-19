import type {
  ProformaSoldItem,
  QuotationMoney,
  QuotationProductRow,
  ProformaRequestItem,
  ProformaRequestRow,
  SupplierOffer,
  SupplierOfferItem,
} from '../models/ventas.models';

/** Lo que Ventas confirma al aprobar: qué se vendió, qué sale de stock y a quién comprar el resto. */
export interface ApprovalChoice {
  lineId: number;
  product: number;
  sku: string;
  description: string;
  quotedQty: number;
  unitPrice: number;
  included: boolean;
  acceptedQty: number;
  stockQty: number;
  supplierId: number | null;
  supplierName: string;
  unitCost: string;
  money: QuotationMoney | null;
  paymentMethods: number | null;
  paymentTerms: string;
  incoterm: string;
}

export interface ApprovalDraftGroup {
  supplierId: number;
  supplierName: string;
  money: QuotationMoney;
  paymentMethods: number | null;
  incoterm: string;
  lineCount: number;
}

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function purchaseQty(choice: ApprovalChoice): number {
  if (!choice.included) return 0;
  return roundQty(Math.max(0, choice.acceptedQty - choice.stockQty));
}

export function buildApprovalChoices(
  lines: QuotationProductRow[],
  proforma: ProformaRequestRow | null,
): ApprovalChoice[] {
  const offers = asOfferList(proforma?.supplier_offers);
  const requestItems = proforma?.request_items ?? [];
  return [...lines]
    .sort((a, b) => a.id - b.id)
    .map((line) => {
      const match = selectedOfferForQuotationLine(offers, line, requestItems);
      const quoted = roundQty(Number(line.cant));
      return {
        lineId: line.id,
        product: fkId(line.product),
        sku: line.line_sku?.trim() || `#${fkId(line.product)}`,
        description: line.line_description?.trim() || '—',
        quotedQty: quoted,
        unitPrice: Number(line.product_price) || 0,
        included: true,
        acceptedQty: Math.max(1, Math.round(quoted)),
        stockQty: 0,
        supplierId: match ? supplierIdOf(match.offer) : null,
        supplierName: supplierLabel(match?.offer ?? null),
        unitCost: match?.item.unit_cost?.trim() || '0.00',
        money: match?.offer.money === 'PEN' || match?.offer.money === 'USD' ? match.offer.money : null,
        paymentMethods:
          match?.offer.payment_methods != null && match.offer.payment_methods > 0
            ? match.offer.payment_methods
            : null,
        paymentTerms: match?.offer.payment_terms?.trim() || '',
        incoterm: match?.offer.incoterm?.trim() || '',
      };
    });
}

/** Lo que entra a la orden de logística. La cotización no se modifica. */
export function soldItemsPayload(choices: ApprovalChoice[]): ProformaSoldItem[] {
  return choices
    .filter((row) => row.included)
    .map((row) => ({ quotation_product: row.lineId, cant: row.acceptedQty }));
}

export function approvalChoicesError(choices: ApprovalChoice[]): string | null {
  const included = choices.filter((row) => row.included);
  if (!included.length) return 'Deja al menos un ítem. Quitar solo lo saca de este pedido.';
  for (const row of included) {
    if (!Number.isInteger(row.acceptedQty) || row.acceptedQty < 1) {
      return `${row.sku}: la cantidad pedida tiene que ser un entero de 1 para arriba.`;
    }
    if (!Number.isInteger(row.stockQty) || row.stockQty < 0 || row.stockQty > row.acceptedQty) {
      return `${row.sku}: el stock no puede superar lo que pidió el cliente.`;
    }
  }
  return null;
}

export function draftGroups(choices: ApprovalChoice[], fallbackMoney: QuotationMoney): ApprovalDraftGroup[] {
  const groups = new Map<string, ApprovalDraftGroup>();
  for (const row of choices) {
    if (purchaseQty(row) <= 0 || row.supplierId == null) continue;
    const money = row.money ?? fallbackMoney;
    const key = `${row.supplierId}:${money}`;
    const current = groups.get(key);
    if (current) {
      current.lineCount += 1;
      continue;
    }
    groups.set(key, {
      supplierId: row.supplierId,
      supplierName: row.supplierName || `Proveedor #${row.supplierId}`,
      money,
      paymentMethods: row.paymentMethods,
      incoterm: row.incoterm,
      lineCount: 1,
    });
  }
  return [...groups.values()];
}

export function formatQty(value: number): string {
  return value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function asOfferList(value: unknown): SupplierOffer[] {
  if (Array.isArray(value)) return value.filter((row): row is SupplierOffer => !!row && typeof row === 'object');
  if (value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results)) {
    return ((value as { results: unknown[] }).results).filter(
      (row): row is SupplierOffer => !!row && typeof row === 'object',
    );
  }
  return [];
}

/**
 * Misma lógica que el detalle: la elección vive en la línea de oferta (`selected`),
 * ligada al ítem de la solicitud. La cotización se cruza por producto o SKU.
 * Si Ventas no recibe `selected`, se usa precio de venta o la única oferta posible.
 */
function selectedOfferForQuotationLine(
  offers: SupplierOffer[],
  line: QuotationProductRow,
  requestItems: ProformaRequestItem[],
): { offer: SupplierOffer; item: SupplierOfferItem } | null {
  const productId = fkId(line.product);
  const lineSku = normalizeSku(line.line_sku);
  const salePrice = Number(line.product_price);
  const linkedRequestItems = requestItems.filter((requestItem) => {
    const requestProduct = fkId(requestItem.product);
    const requestSku = normalizeSku(requestItem.requested_sku);
    const sameProduct = requestProduct > 0 && requestProduct === productId;
    const sameSku = !!lineSku && !!requestSku && lineSku === requestSku;
    return sameProduct || sameSku;
  });

  const byProduct = findBest(
    (item) => offerProductId(item) === productId && productId > 0,
    offers,
    salePrice,
  );
  if (byProduct) return byProduct;

  for (const requestItem of linkedRequestItems) {
    const byRequestItem = findBest(
      (item) => fkId(item.proforma_request_item) === requestItem.id,
      offers,
      salePrice,
    );
    if (byRequestItem) return byRequestItem;
  }

  if (lineSku) {
    const bySku = findBest((item) => normalizeSku(offerSku(item)) === lineSku, offers, salePrice);
    if (bySku) return bySku;
  }

  const selected = allSelected(offers);
  if (selected.length === 1) return selected[0];

  // Un solo proveedor en la solicitud: úsalo si cotizó ese producto/SKU.
  if (offers.length === 1) {
    const offer = offers[0];
    const item =
      (offer.items ?? []).find((row) => offerProductId(row) === productId && productId > 0) ??
      (lineSku
        ? (offer.items ?? []).find((row) => normalizeSku(offerSku(row)) === lineSku)
        : undefined) ??
      (linkedRequestItems.length
        ? (offer.items ?? []).find((row) =>
            linkedRequestItems.some((requestItem) => fkId(row.proforma_request_item) === requestItem.id),
          )
        : undefined);
    if (item) return { offer, item };
  }

  return null;
}

function findBest(
  match: (item: SupplierOfferItem) => boolean,
  offers: SupplierOffer[],
  salePrice: number,
): { offer: SupplierOffer; item: SupplierOfferItem } | null {
  const candidates: { offer: SupplierOffer; item: SupplierOfferItem }[] = [];
  for (const offer of offers) {
    for (const item of offer.items ?? []) {
      if (match(item)) candidates.push({ offer, item });
    }
  }
  if (!candidates.length) return null;

  const selected = candidates.find((row) => isSelected(row.item));
  if (selected) return selected;

  if (Number.isFinite(salePrice) && salePrice > 0) {
    const byPrice = candidates.find((row) => pricesClose(row.item.sale_unit_price, salePrice));
    if (byPrice) return byPrice;
  }

  if (candidates.length === 1) return candidates[0];
  return null;
}

function allSelected(offers: SupplierOffer[]): { offer: SupplierOffer; item: SupplierOfferItem }[] {
  const rows: { offer: SupplierOffer; item: SupplierOfferItem }[] = [];
  for (const offer of offers) {
    for (const item of offer.items ?? []) {
      if (isSelected(item)) rows.push({ offer, item });
    }
  }
  return rows;
}

function isSelected(item: SupplierOfferItem): boolean {
  const value = item.selected as unknown;
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'si' || text === 'sí';
}

function pricesClose(raw: string | number | null | undefined, target: number): boolean {
  const price = Number(raw);
  if (!Number.isFinite(price) || !Number.isFinite(target)) return false;
  return Math.abs(price - target) < 0.009;
}

function offerProductId(item: SupplierOfferItem): number {
  const fromProduct = fkId(item.product);
  if (fromProduct > 0) return fromProduct;
  return fkId(item.product_detail?.id);
}

function offerSku(item: SupplierOfferItem): string {
  return item.product_detail?.sku?.trim() || item.supplier_part_number?.trim() || '';
}

function normalizeSku(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function fkId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object' && 'id' in value) {
    return fkId((value as { id: unknown }).id);
  }
  return 0;
}

function supplierIdOf(offer: SupplierOffer): number | null {
  const id = fkId(offer.supplier);
  return id > 0 ? id : null;
}

function supplierLabel(offer: SupplierOffer | null): string {
  if (!offer) return '';
  const name = offer.supplier_detail?.name?.trim();
  if (name) return name;
  const id = supplierIdOf(offer);
  return id != null ? `Proveedor #${id}` : '';
}
