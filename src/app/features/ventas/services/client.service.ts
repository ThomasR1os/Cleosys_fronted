import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  ClientCreatePayload,
  ClientLookupByRucResponse,
  ClientRow,
  SunatRucIdentificacion,
} from '../models/ventas.models';

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/clients`;
  private readonly sunatRucIdentificacion = `${environment.apiUrl}/sunat/ruc/identificacion`;

  /** Listado por defecto: "míos" (acotado por vendedor en el backend). */
  list(): Observable<ClientRow[]> {
    return this.http.get<ClientRow[]>(`${this.base}/`);
  }

  /**
   * Listado ampliado: todos los clientes de la empresa del usuario.
   * Solo lo usa la página `/ventas/clientes`; el backend igual valida pertenencia por empresa
   * y los permisos de edición/borrado se mantienen ("solo míos" o admin).
   */
  listForCompany(): Observable<ClientRow[]> {
    const params = new HttpParams().set('scope', 'company');
    return this.http.get<ClientRow[]>(`${this.base}/`, { params });
  }

  /**
   * Cliente por RUC dentro de la empresa + resumen comercial y contactos (core).
   * `scope`: `company` (default) o `mine` según reglas del backend.
   */
  lookupByRuc(
    ruc: string,
    scope: 'company' | 'mine' = 'company',
  ): Observable<ClientLookupByRucResponse> {
    const params = new HttpParams().set('ruc', ruc.trim()).set('scope', scope);
    return this.http.get<ClientLookupByRucResponse>(`${this.base}/lookup-by-ruc/`, {
      params,
    });
  }

  retrieve(id: number): Observable<ClientRow> {
    return this.http.get<ClientRow>(`${this.base}/${id}/`);
  }

  create(body: ClientCreatePayload & { id?: number }): Observable<ClientRow> {
    return this.http.post<ClientRow>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<Pick<ClientRow, 'ruc' | 'name'>>): Observable<ClientRow> {
    return this.http.patch<ClientRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /** GET ?ruc= — respuesta con RUC y razón social desde SUNAT. */
  consultRucIdentificacion(ruc: string): Observable<SunatRucIdentificacion> {
    const trimmed = ruc.trim();
    return this.http.get<SunatRucIdentificacion>(`${this.sunatRucIdentificacion}/`, {
      params: { ruc: trimmed },
    });
  }
}
