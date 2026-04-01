import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { LogisticTask } from '../models/logistica.models';

@Injectable({ providedIn: 'root' })
export class LogisticTaskService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/logistica/logistic-tasks`;

  list(): Observable<LogisticTask[]> {
    return this.http.get<LogisticTask[]>(`${this.base}/`);
  }

  create(body: Partial<LogisticTask>): Observable<LogisticTask> {
    return this.http.post<LogisticTask>(`${this.base}/`, body);
  }

  update(id: number, body: Partial<LogisticTask>): Observable<LogisticTask> {
    return this.http.patch<LogisticTask>(`${this.base}/${id}/`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }
}
