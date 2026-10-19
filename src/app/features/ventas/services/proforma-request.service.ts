import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  concatMap,
  filter,
  forkJoin,
  from,
  map,
  of,
  switchMap,
  tap,
  toArray,
  type OperatorFunction,
} from 'rxjs';
import { QUERY_STALE_MS, StaleCache } from '../../../core/utils/stale-cache';
import { environment } from '../../../../environments/environment';
import { LogisticsOrderItemService } from '../../logistica/services/logistics-order-item.service';
import { LogisticsOrderService } from '../../logistica/services/logistics-order.service';
import { resolveDrfNext } from '../../logistica/services/drf-list';
import { TaskService } from '../../tareas/services/task.service';
import { parseProformaListTextAsync, slimListRow } from '../utils/proforma-list-parse';
import type {
  AssignableUser,
  GenerateQuotationPayload,
  ProformaClarification,
  ProformaRecommendation,
  ProformaRecommendationLine,
  ProformaRecommendationMatch,
  ProformaRequestAttachment,
  ProformaRequestCreatePayload,
  ProformaRequestItem,
  ProformaRequestListParams,
  ProformaRequestPatchPayload,
  ProformaRequestRow,
  QuotationRow,
  RecommendationLineAvailability,
  RecommendationMatchAvailability,
  SupplierOffer,
} from '../models/ventas.models';
import { ProformaRequestItemService } from './proforma-request-item.service';
import { QuotationProductService } from './quotation-product.service';
import { QuotationService } from './quotation.service';
import { SupplierOfferService } from './supplier-offer.service';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

function asOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function asMatchAvailability(value: unknown): RecommendationMatchAvailability {
  return value === 'IMPORTACION' ? 'IMPORTACION' : 'STOCK';
}

function asLineAvailability(value: unknown): RecommendationLineAvailability {
  if (value === 'IMPORTACION' || value === 'NO_ENCONTRADO') return value;
  return 'STOCK';
}

function normalizeMatch(row: Record<string, unknown>): ProformaRecommendationMatch {
  return {
    product_id: Number(row['product_id']),
    sku: String(row['sku'] ?? ''),
    description: String(row['description'] ?? ''),
    stock: Number(row['stock'] ?? 0),
    availability: asMatchAvailability(row['availability']),
  };
}

function normalizeRecommendation(row: Record<string, unknown>): ProformaRecommendation {
  const linesRaw = Array.isArray(row['lines']) ? row['lines'] : [];
  const unread = Array.isArray(row['unreadable_attachments']) ? row['unreadable_attachments'] : [];
  return {
    id: Number(row['id']),
    lines: linesRaw.map((line) => {
      const item = line as Record<string, unknown>;
      const matchesRaw = Array.isArray(item['matches']) ? item['matches'] : [];
      const brand = item['brand'];
      const parsed: ProformaRecommendationLine = {
        requested: String(item['requested'] ?? ''),
        qty: Number(item['qty'] ?? 1),
        brand: brand == null || brand === '' ? null : String(brand),
        availability: asLineAvailability(item['availability']),
        message: asOptionalText(item['message']),
        matches: matchesRaw
          .slice(0, 3)
          .map((match) => normalizeMatch(match as Record<string, unknown>)),
      };
      return parsed;
    }),
    message: asOptionalText(row['message']),
    unreadable_attachments: unread.map((name) => String(name)),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

function normalizeAttachment(row: Record<string, unknown>): ProformaRequestAttachment {
  return {
    id: Number(row['id']),
    name: String(row['name'] ?? ''),
    url: String(row['url'] ?? ''),
    content_type: String(row['content_type'] ?? ''),
  };
}

/** Ignora fallos de hijos para no bloquear el resto del cascado. */
function ignoreFail<T>(): OperatorFunction<T, T | null> {
  return catchError(() => of(null));
}

@Injectable({ providedIn: 'root' })
export class ProformaRequestService {
  private readonly http = inject(HttpClient);
  private readonly itemsApi = inject(ProformaRequestItemService);
  private readonly offersApi = inject(SupplierOfferService);
  private readonly quotationsApi = inject(QuotationService);
  private readonly quotationProductsApi = inject(QuotationProductService);
  private readonly tasksApi = inject(TaskService);
  private readonly logisticsOrdersApi = inject(LogisticsOrderService);
  private readonly logisticsOrderItemsApi = inject(LogisticsOrderItemService);
  private readonly base = `${environment.apiUrl}/ventas/proforma-requests`;
  private readonly listCache = new StaleCache<ProformaRequestRow[]>(QUERY_STALE_MS);
  private readonly assignableCache = new StaleCache<AssignableUser[]>(QUERY_STALE_MS);

  peekList(): ProformaRequestRow[] | undefined {
    const cached = this.listCache.fresh();
    if (!cached) return undefined;
    return cached.map((row) => slimListRow(row)).filter((row): row is ProformaRequestRow => row != null);
  }

  /**
   * GET /api/ventas/proforma-requests/
   * Páginas de 10. El serializer anida ítems/ofertas (~MB por página grande);
   * se pide poco, se recorta al llegar y se emite cada página para pintar ya.
   */
  listIncremental(params?: ProformaRequestListParams): Observable<{
    rows: ProformaRequestRow[];
    done: boolean;
  }> {
    const cached = this.listCache.fresh();
    const hasFilters = !!(params?.mine || params?.assigned_user != null || params?.workflow_status);
    const maxPages = params?.maxPages ?? 25;
    const pageSize = params?.pageSize ?? 10;
    const bypassCache = maxPages > 25 || pageSize !== 10;
    if (cached && !hasFilters && !bypassCache) return of({ rows: cached, done: true });

    let httpParams = new HttpParams().set('page_size', String(pageSize)).set('page', '1');
    if (params?.mine) httpParams = httpParams.set('mine', '1');
    if (params?.assigned_user != null) {
      httpParams = httpParams.set('assigned_user', String(params.assigned_user));
    }
    if (params?.workflow_status) httpParams = httpParams.set('workflow_status', params.workflow_status);

    return new Observable((subscriber) => {
      let cancelled = false;
      const acc: ProformaRequestRow[] = [];

      const load = (url: string, requestParams: HttpParams | undefined, page: number): void => {
        if (cancelled) return;
        if (page >= maxPages) {
          if (!hasFilters && !bypassCache) this.listCache.write(acc);
          subscriber.next({ rows: acc, done: true });
          subscriber.complete();
          return;
        }
        this.http.get(url, { params: requestParams, responseType: 'text' }).pipe(
          switchMap((text) => from(parseProformaListTextAsync(text))),
        ).subscribe({
          next: (parsed) => {
            if (cancelled) return;
            acc.push(...parsed.rows);
            const nextUrl = parsed.next ? resolveDrfNext(parsed.next) : null;
            if (!nextUrl) acc.sort((a, b) => b.id - a.id);
            subscriber.next({ rows: acc.slice(), done: !nextUrl });
            if (nextUrl) load(nextUrl, undefined, page + 1);
            else {
              if (!hasFilters && !bypassCache) this.listCache.write(acc);
              subscriber.complete();
            }
          },
          error: (err) => subscriber.error(err),
        });
      };

      load(`${this.base}/`, httpParams, 0);
      return () => {
        cancelled = true;
      };
    });
  }

  list(params?: ProformaRequestListParams): Observable<ProformaRequestRow[]> {
    return this.listIncremental(params).pipe(
      filter((page) => page.done),
      map((page) => page.rows),
    );
  }

  retrieve(id: number): Observable<ProformaRequestRow> {
    return this.http.get<ProformaRequestRow>(`${this.base}/${id}/`);
  }

  create(body: ProformaRequestCreatePayload): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  patch(id: number, body: ProformaRequestPatchPayload): Observable<ProformaRequestRow> {
    return this.http
      .patch<ProformaRequestRow>(`${this.base}/${id}/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  /**
   * Elimina la proforma y todo lo vinculado que el API permita borrar:
   * adjuntos, ofertas (y líneas), ítems, tareas, orden interna, cotización (y líneas).
   */
  delete(id: number): Observable<void> {
    return this.deleteRelated(id).pipe(
      switchMap(() => this.http.delete<void>(`${this.base}/${id}/`)),
      tap(() => this.listCache.invalidate()),
    );
  }

  private deleteRelated(id: number): Observable<void> {
    return forkJoin({
      row: this.retrieve(id).pipe(catchError(() => of(null as ProformaRequestRow | null))),
      attachments: this.listAttachments(id).pipe(
        catchError(() => of([] as ProformaRequestAttachment[])),
      ),
      items: this.itemsApi.listByRequest(id).pipe(
        catchError(() => of([] as ProformaRequestItem[])),
      ),
      offers: this.offersApi.listByRequest(id).pipe(catchError(() => of([] as SupplierOffer[]))),
      tasks: this.tasksApi.list({ proforma_request: id }).pipe(catchError(() => of([]))),
    }).pipe(
      switchMap(({ row, attachments, items, offers, tasks }) => {
        const quotationId =
          row?.quotation != null && row.quotation > 0 ? row.quotation : null;
        const logisticsOrderId =
          row?.logistics_order_id != null && row.logistics_order_id > 0
            ? row.logistics_order_id
            : null;
        const offerList =
          offers.length > 0 ? offers : (row?.supplier_offers ?? []);
        const itemList =
          items.length > 0 ? items : (row?.request_items ?? []);
        const taskIds = new Set(
          tasks.map((t) => t.id).filter((n): n is number => n != null && n > 0),
        );
        if (row?.task_id != null && row.task_id > 0) taskIds.add(row.task_id);

        return of(null).pipe(
          switchMap(() => this.deleteAllAttachments(id, attachments)),
          switchMap(() => this.deleteAllOffers(offerList)),
          switchMap(() => this.deleteAllRequestItems(itemList)),
          switchMap(() => this.deleteAllTasks([...taskIds])),
          switchMap(() => this.deleteLogisticsTree(logisticsOrderId, quotationId)),
          switchMap(() =>
            quotationId != null ? this.deleteQuotationTree(quotationId) : of(null),
          ),
          // Si la cotización no se pudo borrar, desvincular para no bloquear la proforma.
          switchMap(() =>
            quotationId != null
              ? this.http
                  .patch(`${this.base}/${id}/`, { quotation: null })
                  .pipe(ignoreFail())
              : of(null),
          ),
          map(() => undefined),
        );
      }),
    );
  }

  private deleteAllAttachments(
    requestId: number,
    attachments: ProformaRequestAttachment[],
  ): Observable<unknown> {
    if (!attachments.length) return of(null);
    return forkJoin(
      attachments.map((att) =>
        this.deleteAttachment(requestId, att.id).pipe(ignoreFail()),
      ),
    );
  }

  private deleteAllOffers(offers: SupplierOffer[]): Observable<unknown> {
    if (!offers.length) return of(null);
    return from(offers).pipe(
      concatMap((offer) => this.deleteOfferTree(offer)),
      toArray(),
    );
  }

  private deleteOfferTree(offer: SupplierOffer): Observable<unknown> {
    const lines$ =
      offer.items && offer.items.length > 0
        ? of(offer.items)
        : this.offersApi.listItemsByOffer(offer.id).pipe(catchError(() => of([])));
    return lines$.pipe(
      switchMap((lines) =>
        lines.length
          ? forkJoin(lines.map((line) => this.offersApi.deleteItem(line.id).pipe(ignoreFail())))
          : of(null),
      ),
      switchMap(() => this.offersApi.remove(offer.id).pipe(ignoreFail())),
    );
  }

  private deleteAllRequestItems(items: ProformaRequestItem[]): Observable<unknown> {
    if (!items.length) return of(null);
    return forkJoin(items.map((item) => this.itemsApi.delete(item.id).pipe(ignoreFail())));
  }

  private deleteAllTasks(taskIds: number[]): Observable<unknown> {
    if (!taskIds.length) return of(null);
    return forkJoin(taskIds.map((tid) => this.tasksApi.delete(tid).pipe(ignoreFail())));
  }

  private deleteLogisticsTree(
    logisticsOrderId: number | null,
    quotationId: number | null,
  ): Observable<unknown> {
    const orders$ =
      logisticsOrderId != null
        ? of([logisticsOrderId])
        : quotationId != null
          ? this.logisticsOrdersApi.list({ quotation: quotationId }).pipe(
              map((rows) => rows.map((r) => r.id).filter((n) => n > 0)),
              catchError(() => of([] as number[])),
            )
          : of([] as number[]);

    return orders$.pipe(
      switchMap((ids) => {
        if (!ids.length) return of(null);
        return from(ids).pipe(
          concatMap((oid) => this.deleteLogisticsOrderTree(oid)),
          toArray(),
        );
      }),
    );
  }

  private deleteLogisticsOrderTree(orderId: number): Observable<unknown> {
    return this.logisticsOrderItemsApi.list(orderId).pipe(
      catchError(() => of([])),
      switchMap((lines) =>
        lines.length
          ? forkJoin(
              lines.map((line) => this.logisticsOrderItemsApi.delete(line.id).pipe(ignoreFail())),
            )
          : of(null),
      ),
      switchMap(() => this.logisticsOrdersApi.delete(orderId).pipe(ignoreFail())),
    );
  }

  private deleteQuotationTree(quotationId: number): Observable<unknown> {
    return this.quotationProductsApi.listByQuotation(quotationId).pipe(
      catchError(() => of([])),
      switchMap((lines) =>
        lines.length
          ? forkJoin(
              lines.map((line) => this.quotationProductsApi.delete(line.id).pipe(ignoreFail())),
            )
          : of(null),
      ),
      switchMap(() => this.quotationsApi.delete(quotationId).pipe(ignoreFail())),
    );
  }

  /** GET /api/ventas/proforma-requests/{id}/attachments/ — array sin paginar. */
  listAttachments(requestId: number): Observable<ProformaRequestAttachment[]> {
    return this.http.get<unknown>(`${this.base}/${requestId}/attachments/`).pipe(
      map((res) => {
        const rows = Array.isArray(res)
          ? res
          : ((res as { results?: unknown[] }).results ?? []);
        return rows.map((row) => normalizeAttachment(row as Record<string, unknown>));
      }),
    );
  }

  /**
   * POST multipart. No fijar Content-Type: el navegador agrega el boundary.
   * `name` es opcional; si no se envía, el servidor usa el nombre del archivo.
   */
  uploadAttachment(
    requestId: number,
    file: File,
    name?: string,
  ): Observable<ProformaRequestAttachment> {
    const body = new FormData();
    body.append('file', file);
    if (name != null && name.trim() !== '') {
      body.append('name', name.trim());
    }
    return this.http
      .post<Record<string, unknown>>(`${this.base}/${requestId}/attachments/`, body)
      .pipe(map((row) => normalizeAttachment(row)));
  }

  /** DELETE /api/ventas/proforma-requests/{id}/attachments/{attachment_id}/ — 204. */
  deleteAttachment(requestId: number, attachmentId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${requestId}/attachments/${attachmentId}/`);
  }

  /** GET /api/ventas/proforma-requests/{id}/recommend/ — 404 si aún no existe. */
  getRecommendation(requestId: number): Observable<ProformaRecommendation> {
    return this.http
      .get<Record<string, unknown>>(`${this.base}/${requestId}/recommend/`)
      .pipe(map((row) => normalizeRecommendation(row)));
  }

  /**
   * POST /api/ventas/proforma-requests/{id}/recommend/
   * Body vacío: el servidor usa la descripción y los adjuntos ya guardados.
   */
  recommend(requestId: number): Observable<ProformaRecommendation> {
    return this.http
      .post<Record<string, unknown>>(`${this.base}/${requestId}/recommend/`, {})
      .pipe(map((row) => normalizeRecommendation(row)));
  }

  /** GET /api/ventas/proforma-requests/assignable-users/ — misma ventana de caché si no hay rol. */
  assignableUsers(role?: string): Observable<AssignableUser[]> {
    if (role) {
      const params = new HttpParams().set('role', role);
      return this.http
        .get<AssignableUser[] | { results: AssignableUser[] }>(`${this.base}/assignable-users/`, {
          params,
        })
        .pipe(map(unwrapList));
    }
    return this.assignableCache.read(() =>
      this.http
        .get<AssignableUser[] | { results: AssignableUser[] }>(`${this.base}/assignable-users/`)
        .pipe(map(unwrapList)),
    );
  }

  listClarifications(id: number): Observable<ProformaClarification[]> {
    return this.http
      .get<ProformaClarification[] | { results: ProformaClarification[] }>(
        `${this.base}/${id}/clarifications/`,
      )
      .pipe(map(unwrapList));
  }

  sendToLogistics(id: number, body: { assigned_user: number; reason?: string }): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/send-to-logistics/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  requestInformation(
    id: number,
    body: { question: string; item?: number | null },
  ): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/request-information/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  answerInformation(
    id: number,
    body: { clarification: number; answer: string },
  ): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/answer-information/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  sendToSupplier(id: number): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/send-to-supplier/`, {})
      .pipe(tap(() => this.listCache.invalidate()));
  }

  generateQuotation(id: number, body: GenerateQuotationPayload): Observable<QuotationRow> {
    return this.http
      .post<QuotationRow>(`${this.base}/${id}/generate-quotation/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  markNotPossible(id: number, body: { reason: string }): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/mark-not-possible/`, body)
      .pipe(tap(() => this.listCache.invalidate()));
  }

  completeFlow(id: number): Observable<ProformaRequestRow> {
    return this.http
      .post<ProformaRequestRow>(`${this.base}/${id}/complete-flow/`, {})
      .pipe(tap(() => this.listCache.invalidate()));
  }
}
