import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { QuotationRow } from '../models/ventas.models';

/** Cliente HTTP: `GET|POST …/api/ventas/quotations/`, `GET|PATCH|PUT|DELETE …/quotations/{id}/`. */
@Injectable({ providedIn: 'root' })
export class QuotationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/quotations`;

  list(): Observable<QuotationRow[]> {
    return this.http.get<QuotationRow[]>(`${this.base}/`);
  }

  create(body: Partial<QuotationRow> & Record<string, unknown>): Observable<QuotationRow> {
    return this.http.post<QuotationRow>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<QuotationRow>): Observable<QuotationRow> {
    return this.http.patch<QuotationRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
