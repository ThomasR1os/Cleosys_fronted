import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  SupplierOffer,
  SupplierOfferCreatePayload,
  SupplierOfferItem,
  SupplierOfferItemWrite,
} from '../models/ventas.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

@Injectable({ providedIn: 'root' })
export class SupplierOfferService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/supplier-offers`;
  private readonly itemsBase = `${environment.apiUrl}/ventas/supplier-offer-items`;

  listByRequest(proformaRequestId: number): Observable<SupplierOffer[]> {
    const params = new HttpParams().set('proforma_request', String(proformaRequestId));
    return this.http
      .get<SupplierOffer[] | { results: SupplierOffer[] }>(`${this.base}/`, { params })
      .pipe(map(unwrapList));
  }

  /** Detalle con ítems anidados (cuando el listado solo trae cabecera). */
  retrieve(id: number): Observable<SupplierOffer> {
    return this.http.get<SupplierOffer>(`${this.base}/${id}/`);
  }

  /** Líneas de una oferta. Algunas respuestas de cabecera no traen `items` anidados. */
  listItemsByOffer(supplierOfferId: number): Observable<SupplierOfferItem[]> {
    const params = new HttpParams().set('supplier_offer', String(supplierOfferId));
    return this.http
      .get<SupplierOfferItem[] | { results: SupplierOfferItem[] }>(`${this.itemsBase}/`, { params })
      .pipe(map(unwrapList));
  }

  create(body: SupplierOfferCreatePayload): Observable<SupplierOffer> {
    return this.http.post<SupplierOffer>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<SupplierOffer>): Observable<SupplierOffer> {
    return this.http.patch<SupplierOffer>(`${this.base}/${id}/`, body);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  createItem(
    body: { supplier_offer: number } & SupplierOfferItemWrite,
  ): Observable<SupplierOfferItem> {
    return this.http.post<SupplierOfferItem>(`${this.itemsBase}/`, body);
  }

  patchItem(id: number, body: Partial<SupplierOfferItem>): Observable<SupplierOfferItem> {
    return this.http.patch<SupplierOfferItem>(`${this.itemsBase}/${id}/`, body);
  }

  deleteItem(id: number): Observable<void> {
    return this.http.delete<void>(`${this.itemsBase}/${id}/`);
  }
}
