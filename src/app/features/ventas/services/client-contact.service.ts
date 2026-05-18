import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  ClientContactCreatePayload,
  ClientContactPatchPayload,
  ClientContactRow,
} from '../models/ventas.models';
import { sanitizeClientContactBody } from '../utils/client-contact-body.utils';

@Injectable({ providedIn: 'root' })
export class ClientContactService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/client-contacts`;

  /**
   * Lista contactos filtrados por cliente (y empresa en el servidor).
   * Query `client` — si el backend usa otro nombre, ajustar aquí.
   */
  listForClient(clientId: number): Observable<ClientContactRow[]> {
    const params = new HttpParams().set('client', String(clientId));
    return this.http
      .get<ClientContactRow[] | { results: ClientContactRow[] }>(`${this.base}/`, { params })
      .pipe(map((res) => (Array.isArray(res) ? res : res.results)));
  }

  create(body: ClientContactCreatePayload): Observable<ClientContactRow> {
    return this.http.post<ClientContactRow>(`${this.base}/`, sanitizeClientContactBody(body));
  }

  patch(id: number, body: ClientContactPatchPayload): Observable<ClientContactRow> {
    return this.http.patch<ClientContactRow>(
      `${this.base}/${id}/`,
      sanitizeClientContactBody(body),
    );
  }
}
