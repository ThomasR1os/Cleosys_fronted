import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { TaskComment, TaskEvent, TaskListParams, TaskRow, TaskSummary } from '../models/task.models';

function unwrapList<T>(res: T[] | { results: T[] }): T[] {
  return Array.isArray(res) ? res : (res.results ?? []);
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tareas/tasks`;

  list(params?: TaskListParams): Observable<TaskRow[]> {
    let httpParams = new HttpParams();
    if (params?.mine) httpParams = httpParams.set('mine', '1');
    if (params?.unassigned) httpParams = httpParams.set('unassigned', '1');
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.queue) httpParams = httpParams.set('queue', params.queue);
    if (params?.assigned_user != null) httpParams = httpParams.set('assigned_user', String(params.assigned_user));
    if (params?.proforma_request != null) {
      httpParams = httpParams.set('proforma_request', String(params.proforma_request));
    }
    return this.http
      .get<TaskRow[] | { results: TaskRow[] }>(`${this.base}/`, { params: httpParams })
      .pipe(map(unwrapList));
  }

  summary(): Observable<TaskSummary> {
    return this.http.get<TaskSummary>(`${this.base}/summary/`);
  }

  retrieve(id: number): Observable<TaskRow> {
    return this.http.get<TaskRow>(`${this.base}/${id}/`);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  take(id: number): Observable<TaskRow> {
    return this.http.post<TaskRow>(`${this.base}/${id}/take/`, {});
  }

  start(id: number): Observable<TaskRow> {
    return this.http.post<TaskRow>(`${this.base}/${id}/start/`, {});
  }

  assign(id: number, body: { assigned_user: number; queue?: string; reason?: string }): Observable<TaskRow> {
    return this.http.post<TaskRow>(`${this.base}/${id}/assign/`, body);
  }

  addComment(id: number, body: string): Observable<TaskComment> {
    return this.http.post<TaskComment>(`${this.base}/${id}/comments/`, { body });
  }

  events(id: number): Observable<TaskEvent[]> {
    return this.http
      .get<TaskEvent[] | { results: TaskEvent[] }>(`${this.base}/${id}/events/`)
      .pipe(map(unwrapList));
  }
}
