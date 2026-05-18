import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  ClientContactPayload,
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

  /**
   * Alta de cliente + contacto inicial.
   * No enviar `user`/`owner` en `contact`: el serializer anidado de POST /clients/ no lo acepta
   * (400 «Expected pk value, received User»). El encargado se asigna con PATCH en client-contacts.
   */
  create(body: ClientCreatePayload & { id?: number }): Observable<ClientRow> {
    const contact: ClientContactPayload = {
      contact_first_name: body.contact.contact_first_name.trim(),
      contact_last_name: body.contact.contact_last_name.trim(),
    };
    const email = body.contact.email?.trim();
    const phone = body.contact.phone?.trim();
    if (email) contact.email = email;
    if (phone) contact.phone = phone;

    const payload: ClientCreatePayload & { id?: number } = {
      ruc: body.ruc.trim(),
      name: body.name.trim(),
      contact,
    };
    if (body.id != null) payload.id = body.id;
    return this.http.post<ClientRow>(`${this.base}/`, payload);
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
