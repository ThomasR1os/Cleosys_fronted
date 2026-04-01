import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { ClientCreatePayload, ClientRow } from '../models/ventas.models';

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/clients`;

  list(): Observable<ClientRow[]> {
    return this.http.get<ClientRow[]>(`${this.base}/`);
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
}
