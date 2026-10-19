import { Injectable, inject } from '@angular/core';
import { Observable, catchError, concatMap, forkJoin, from, map, of, switchMap, toArray } from 'rxjs';
import { formatHttpError } from '../../../core/utils/api-errors.utils';
import { toDecimalString, type PurchaseOrderMoney } from '../../logistica/models/purchase-order.models';
import type { LogisticsOrderItem } from '../../logistica/models/logistics-order.models';
import { LogisticsOrderItemService } from '../../logistica/services/logistics-order-item.service';
import { LogisticsOrderService } from '../../logistica/services/logistics-order.service';
import { PurchaseOrderService } from '../../logistica/services/purchase-order.service';
import type {
  ProformaRequestItem,
  QuotationMoney,
  QuotationRow,
  ProformaRequestRow,
  SupplierOffer,
  SupplierOfferItem,
} from '../models/ventas.models';
import {
  asOfferList,
  buildApprovalChoices,
  purchaseQty,
  roundQty,
  type ApprovalChoice,
} from '../utils/sale-approval';
import { ProformaRequestItemService } from './proforma-request-item.service';
import { ProformaRequestService } from './proforma-request.service';
import { QuotationProductService } from './quotation-product.service';
import { QuotationService } from './quotation.service';
import { SupplierOfferService } from './supplier-offer.service';

export interface SaleApprovalContext {
  quotation: QuotationRow;
  proforma: ProformaRequestRow | null;
  choices: ApprovalChoice[];
  /** Diagnóstico si Ventas no ve proveedor (ofertas / líneas / elegidas). */
  offerDebug?: string;
}

export interface SaleApprovalDraft {
  id: number;
  correlativo: string;
  supplierName: string;
}

export interface SaleApprovalResult {
  logisticsOrderId: number | null;
  drafts: SaleApprovalDraft[];
  stockLines: { sku: string; qty: number }[];
  warnings: string[];
}

interface PurchasePlanLine {
  choice: ApprovalChoice;
  qty: number;
  logisticsItemId: number | null;
}

/**
 * Al aprobar, Ventas no elige proveedor. Los borradores de OC salen
 * del proveedor marcado en la oferta de la solicitud.
 */
@Injectable({ providedIn: 'root' })
export class SaleApprovalService {
  private readonly quotationsApi = inject(QuotationService);
  private readonly qpApi = inject(QuotationProductService);
  private readonly proformasApi = inject(ProformaRequestService);
  private readonly offersApi = inject(SupplierOfferService);
  private readonly requestItemsApi = inject(ProformaRequestItemService);
  private readonly logisticsApi = inject(LogisticsOrderService);
  private readonly logisticsItemsApi = inject(LogisticsOrderItemService);
  private readonly purchaseOrdersApi = inject(PurchaseOrderService);

  loadChoices(quotationId: number, proformaId: number | null): Observable<SaleApprovalContext> {
    return forkJoin({
      lines: this.qpApi.listByQuotation(quotationId),
      quotation: this.quotationsApi.retrieve(quotationId),
      proforma: this.resolveProforma(quotationId, proformaId),
    }).pipe(
      switchMap(({ lines, quotation, proforma }) => {
        if (!proforma) {
          return of({
            quotation,
            proforma: null,
            choices: buildApprovalChoices(lines, null),
            offerDebug: 'Sin solicitud vinculada a la cotización',
          });
        }
        return this.withOffers(proforma).pipe(
          map((full) => ({
            quotation,
            proforma: full,
            choices: buildApprovalChoices(lines, full),
            offerDebug: offerDebugText(full),
          })),
        );
      }),
    );
  }

  private resolveProforma(
    quotationId: number,
    proformaId: number | null,
  ): Observable<ProformaRequestRow | null> {
    if (proformaId != null && proformaId > 0) {
      return this.proformasApi.retrieve(proformaId);
    }
    return this.proformasApi.list().pipe(
      switchMap((rows) => {
        const found = rows.find((row) => row.quotation === quotationId);
        return found ? this.proformasApi.retrieve(found.id) : of(null);
      }),
      catchError(() => of(null)),
    );
  }

  /**
   * Tras aprobar: anota stock y crea un borrador de OC por proveedor
   * de la oferta elegida. La cotización no se modifica.
   */
  finishApprovedSale(args: {
    quotationId: number;
    logisticsOrderId: number | null | undefined;
    choices: ApprovalChoice[];
    paymentMethods: number | null;
    money: QuotationMoney;
    reference: string;
  }): Observable<SaleApprovalResult> {
    const stockLines = args.choices
      .filter((row) => row.included && row.stockQty > 0)
      .map((row) => ({ sku: row.sku, qty: roundQty(row.stockQty) }));
    return this.resolveOrderId(args.quotationId, args.logisticsOrderId).pipe(
      switchMap((orderId) => {
        if (!orderId) {
          return of({
            logisticsOrderId: null,
            drafts: [],
            stockLines,
            warnings: [
              'La venta quedó aprobada, pero no apareció el pedido de logística. No se generaron borradores de compra.',
            ],
          });
        }
        return this.logisticsItemsApi.list(orderId).pipe(
          switchMap((items) =>
            this.issueDrafts({
              orderId,
              choices: args.choices,
              items,
              paymentMethods: args.paymentMethods,
              money: args.money,
              reference: args.reference,
              stockLines,
            }),
          ),
        );
      }),
    );
  }

  /**
   * Igual que el detalle: si el retrieve ya trae ofertas, se usan.
   * Solo si vienen vacías se lista. Cada cabecera sin ítems se completa
   * con retrieve + listado de ítems (Ventas a veces no anida `items`).
   */
  private withOffers(proforma: ProformaRequestRow): Observable<ProformaRequestRow> {
    const nested = asOfferList(proforma.supplier_offers);
    const requestItems$ = proforma.request_items?.length
      ? of(proforma.request_items)
      : this.requestItemsApi.listByRequest(proforma.id).pipe(catchError(() => of([] as ProformaRequestItem[])));
    const offers$ = nested.length
      ? of(nested)
      : this.offersApi.listByRequest(proforma.id).pipe(
          map((rows) => asOfferList(rows)),
          catchError(() => of([] as SupplierOffer[])),
        );

    return forkJoin({ offers: offers$, requestItems: requestItems$ }).pipe(
      switchMap(({ offers, requestItems }) =>
        this.hydrateOfferItems(offers).pipe(
          map((fullOffers) => ({
            ...proforma,
            request_items: requestItems.length ? requestItems : (proforma.request_items ?? []),
            supplier_offers: fullOffers,
          })),
        ),
      ),
      catchError(() => of(proforma)),
    );
  }

  private hydrateOfferItems(offers: SupplierOffer[]): Observable<SupplierOffer[]> {
    if (!offers.length) return of([]);
    return forkJoin(
      offers.map((offer) => {
        const existing = asItemList(offer.items);
        if (existing.length && existing.some((item) => offerItemSelected(item))) {
          return of({ ...offer, items: existing });
        }
        return forkJoin({
          detail: this.offersApi.retrieve(offer.id).pipe(catchError(() => of(null as SupplierOffer | null))),
          listed: this.offersApi.listItemsByOffer(offer.id).pipe(catchError(() => of([] as SupplierOfferItem[]))),
        }).pipe(
          map(({ detail, listed }) => {
            const fromDetail = asItemList(detail?.items);
            const items = mergeOfferItems(mergeOfferItems(existing, fromDetail), listed);
            return {
              ...(detail ?? offer),
              ...offer,
              supplier: offer.supplier || detail?.supplier || 0,
              supplier_detail: offer.supplier_detail ?? detail?.supplier_detail ?? null,
              money: offer.money ?? detail?.money ?? null,
              payment_methods: offer.payment_methods ?? detail?.payment_methods ?? null,
              payment_terms: offer.payment_terms ?? detail?.payment_terms ?? null,
              incoterm: offer.incoterm ?? detail?.incoterm ?? null,
              items,
            } satisfies SupplierOffer;
          }),
        );
      }),
    );
  }

  private resolveOrderId(
    quotationId: number,
    logisticsOrderId: number | null | undefined,
  ): Observable<number | null> {
    if (logisticsOrderId != null && logisticsOrderId > 0) return of(logisticsOrderId);
    return this.logisticsApi.list({ quotation: quotationId }).pipe(
      map((orders) => orders[0]?.id ?? null),
      catchError(() => of(null)),
    );
  }

  private issueDrafts(args: {
    orderId: number;
    choices: ApprovalChoice[];
    items: LogisticsOrderItem[];
    paymentMethods: number | null;
    money: QuotationMoney;
    reference: string;
    stockLines: { sku: string; qty: number }[];
  }): Observable<SaleApprovalResult> {
    const warnings: string[] = [];
    const pool = new Map<number, LogisticsOrderItem[]>();
    for (const item of args.items) {
      const list = pool.get(item.product) ?? [];
      list.push(item);
      pool.set(item.product, list);
    }

    const plans: PurchasePlanLine[] = [];
    for (const choice of args.choices) {
      const qty = purchaseQty(choice);
      if (qty <= 0) continue;
      if (choice.supplierId == null) {
        warnings.push(
          `${choice.sku}: no tiene proveedor elegido en la solicitud. Logística lo verá pendiente.`,
        );
        continue;
      }
      const item = pool.get(choice.product)?.shift() ?? null;
      if (!item) {
        warnings.push(`${choice.sku}: el pedido de logística no trajo esa línea. No entró al borrador.`);
        continue;
      }
      plans.push({ choice, qty, logisticsItemId: item.id });
    }

    const groups = new Map<string, PurchasePlanLine[]>();
    for (const plan of plans) {
      const supplierId = plan.choice.supplierId;
      if (supplierId == null) continue;
      const money = plan.choice.money ?? args.money;
      const key = `${supplierId}:${money}`;
      const list = groups.get(key) ?? [];
      list.push(plan);
      groups.set(key, list);
    }

    const entries = [...groups.values()];
    const created$ = entries.length
      ? from(entries).pipe(
          concatMap((group) => {
            const head = group[0].choice;
            const supplierId = head.supplierId ?? 0;
            const money = (head.money ?? args.money) as PurchaseOrderMoney;
            const payment = head.paymentMethods ?? args.paymentMethods;
            return this.purchaseOrdersApi
              .create({
                supplier: supplierId,
                money,
                payment_methods: payment != null && payment > 0 ? payment : null,
                payment_terms: head.paymentTerms.trim(),
                incoterm: head.incoterm.trim().toUpperCase(),
                expected_delivery_date: null,
                supplier_reference: args.reference.slice(0, 120),
                warehouse: null,
                discount: '0.00',
                tax: '18.00',
                notes: this.draftNote(args.reference, group),
                status: 'BORRADOR',
                items: group.map((plan) => ({
                  product: plan.choice.product,
                  cant: toDecimalString(plan.qty),
                  unit_cost: toDecimalString(plan.choice.unitCost),
                  logistics_order_item: plan.logisticsItemId ?? undefined,
                })),
              })
              .pipe(
                map((order) => ({
                  ok: {
                    id: order.id,
                    correlativo: order.correlativo || `Orden #${order.id}`,
                    supplierName: head.supplierName || `Proveedor #${supplierId}`,
                  } satisfies SaleApprovalDraft,
                  error: null as string | null,
                })),
                catchError((err) =>
                  of({
                    ok: null as SaleApprovalDraft | null,
                    error: `${head.supplierName || 'Proveedor'}: ${formatHttpError(err)}`,
                  }),
                ),
              );
          }),
          toArray(),
        )
      : of([] as { ok: SaleApprovalDraft | null; error: string | null }[]);

    return created$.pipe(
      switchMap((results) => {
        const drafts = results.flatMap((row) => (row.ok ? [row.ok] : []));
        const draftErrors = results.flatMap((row) => (row.error ? [row.error] : []));
        const allWarnings = [...warnings, ...draftErrors];
        const uncoveredPurchase = args.choices.some((row) => {
          const qty = purchaseQty(row);
          if (qty <= 0) return false;
          return row.supplierId == null || !plans.some((plan) => plan.choice.lineId === row.lineId);
        });
        const canClose =
          args.stockLines.length > 0 && draftErrors.length === 0 && !uncoveredPurchase;
        return this.annotateOrder(args.orderId, drafts, args.stockLines, canClose).pipe(
          map((noteWarning) => ({
            logisticsOrderId: args.orderId,
            drafts,
            stockLines: args.stockLines,
            warnings: noteWarning ? [...allWarnings, noteWarning] : allWarnings,
          })),
        );
      }),
    );
  }

  private draftNote(reference: string, group: PurchasePlanLine[]): string {
    const lines = group
      .map((plan) => `${plan.choice.sku} x ${toDecimalString(plan.qty)}`)
      .join(', ');
    const ref = reference.trim();
    return ref
      ? `Borrador al aprobar ${ref}. ${lines}`
      : `Borrador al aprobar la cotización. ${lines}`;
  }

  private annotateOrder(
    orderId: number,
    drafts: SaleApprovalDraft[],
    stockLines: { sku: string; qty: number }[],
    closeStock: boolean,
  ): Observable<string | null> {
    if (!drafts.length && !stockLines.length) return of(null);
    const stockText = stockLines.length
      ? `En stock, no comprar: ${stockLines.map((row) => `${row.sku} x ${toDecimalString(row.qty)}`).join(', ')}.`
      : '';
    const draftText = drafts.length
      ? `Borradores de compra: ${drafts.map((row) => row.correlativo).join(', ')}.`
      : '';
    const extra = [stockText, draftText].filter(Boolean).join(' ');
    return this.logisticsApi.retrieve(orderId).pipe(
      switchMap((order) => {
        const notes = order.notes?.trim() ? `${order.notes.trim()}\n${extra}` : extra;
        const status =
          closeStock && (order.status === 'PENDIENTE' || order.status === 'PARCIAL')
            ? 'CERRADA'
            : order.status;
        return this.logisticsApi.update(orderId, { status, notes });
      }),
      map(() => null),
      catchError((err) => of(formatHttpError(err))),
    );
  }
}

function offerDebugText(proforma: ProformaRequestRow): string {
  const offers = asOfferList(proforma.supplier_offers);
  let items = 0;
  let selected = 0;
  for (const offer of offers) {
    for (const item of asItemList(offer.items)) {
      items += 1;
      if (offerItemSelected(item)) selected += 1;
    }
  }
  return `${offers.length} oferta(s) · ${items} línea(s) · ${selected} elegida(s)`;
}

function asItemList(value: unknown): SupplierOfferItem[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is SupplierOfferItem => !!row && typeof row === 'object');
  }
  if (value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results)) {
    return ((value as { results: unknown[] }).results).filter(
      (row): row is SupplierOfferItem => !!row && typeof row === 'object',
    );
  }
  return [];
}

function mergeOfferItems(a: SupplierOfferItem[], b: SupplierOfferItem[]): SupplierOfferItem[] {
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const byId = new Map<number, SupplierOfferItem>();
  for (const item of [...a, ...b]) {
    if (item?.id == null) continue;
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...prev,
      ...item,
      selected: offerItemSelected(item) || offerItemSelected(prev) ? true : (item.selected ?? prev.selected),
    });
  }
  if (byId.size) return [...byId.values()];
  const aSelected = a.filter(offerItemSelected).length;
  const bSelected = b.filter(offerItemSelected).length;
  if (aSelected !== bSelected) return aSelected > bSelected ? a : b;
  return a.length >= b.length ? a : b;
}

function offerItemSelected(item: SupplierOfferItem): boolean {
  const value = item.selected as unknown;
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'si' || text === 'sí';
}
