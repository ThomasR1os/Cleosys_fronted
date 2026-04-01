import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type {
  AdminSetPasswordBody,
  AdminUser,
  AdminUserCreateRequest,
  AdminUserUpdateRequest,
  Company,
} from '../models/admin-users.models';

@Injectable({ providedIn: 'root' })
export class AdminUserService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accounts/users`;

  list(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[] | { results: AdminUser[] }>(`${this.base}/`).pipe(
      map((res) => (Array.isArray(res) ? res : res.results)),
    );
  }

  retrieve(id: number): Observable<AdminUser> {
    return this.http.get<AdminUser>(`${this.base}/${id}/`);
  }

  create(body: AdminUserCreateRequest): Observable<AdminUser> {
    return this.http.post<AdminUser>(`${this.base}/`, body);
  }

  update(id: number, body: AdminUserUpdateRequest): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  /** POST /api/accounts/users/{id}/set-password/ → 204 */
  setPassword(id: number, body: AdminSetPasswordBody): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/set-password/`, body);
  }

  listCompanies(): Observable<Company[]> {
    return this.http
      .get<Company[] | { results: Company[] }>(`${environment.apiUrl}/companies/`)
      .pipe(map((res) => (Array.isArray(res) ? res : res.results)));
  }
}
