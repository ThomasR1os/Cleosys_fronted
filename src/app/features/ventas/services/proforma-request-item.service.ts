import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ProformaRequestItem, ProformaRequestItemPayload } from '../models/ventas.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

@Injectable({ providedIn: 'root' })
export class ProformaRequestItemService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/proforma-request-items`;

  listByRequest(proformaRequestId: number): Observable<ProformaRequestItem[]> {
    const params = new HttpParams().set('proforma_request', String(proformaRequestId));
    return this.http
      .get<ProformaRequestItem[] | { results: ProformaRequestItem[] }>(`${this.base}/`, { params })
      .pipe(map(unwrapList));
  }

  create(body: ProformaRequestItemPayload & { proforma_request: number }): Observable<ProformaRequestItem> {
    return this.http.post<ProformaRequestItem>(`${this.base}/`, body);
  }

  patch(id: number, body: Partial<ProformaRequestItemPayload>): Observable<ProformaRequestItem> {
    return this.http.patch<ProformaRequestItem>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
