import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ClientContactRow } from '../models/ventas.models';

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
}
