import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { QuotationProductRow } from '../models/ventas.models';

@Injectable({ providedIn: 'root' })
export class QuotationProductService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/quotation-products`;

  list(): Observable<QuotationProductRow[]> {
    return this.http.get<QuotationProductRow[]>(`${this.base}/`);
  }

  create(body: Partial<QuotationProductRow>): Observable<QuotationProductRow> {
    return this.http.post<QuotationProductRow>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<QuotationProductRow>): Observable<QuotationProductRow> {
    return this.http.patch<QuotationProductRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
