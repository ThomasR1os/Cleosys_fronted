import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  AssignableUser,
  ProformaRequestCreatePayload,
  ProformaRequestPatchPayload,
  ProformaRequestRow,
} from '../models/ventas.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : res.results;
}

@Injectable({ providedIn: 'root' })
export class ProformaRequestService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ventas/proforma-requests`;

  list(): Observable<ProformaRequestRow[]> {
    return this.http
      .get<ProformaRequestRow[] | { results: ProformaRequestRow[] }>(`${this.base}/`)
      .pipe(map(unwrapList));
  }

  retrieve(id: number): Observable<ProformaRequestRow> {
    return this.http.get<ProformaRequestRow>(`${this.base}/${id}/`);
  }

  create(body: ProformaRequestCreatePayload): Observable<ProformaRequestRow> {
    return this.http.post<ProformaRequestRow>(`${this.base}/`, body);
  }

  patch(id: number, body: ProformaRequestPatchPayload): Observable<ProformaRequestRow> {
    return this.http.patch<ProformaRequestRow>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  assignableUsers(): Observable<AssignableUser[]> {
    return this.http
      .get<AssignableUser[] | { results: AssignableUser[] }>(`${this.base}/assignable-users/`)
      .pipe(map(unwrapList));
  }
}
