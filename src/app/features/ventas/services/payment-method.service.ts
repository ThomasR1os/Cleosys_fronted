import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { PaymentMethodRow } from '../models/ventas.models';

@Injectable({ providedIn: 'root' })
export class PaymentMethodService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/payment-methods`;

  list(): Observable<PaymentMethodRow[]> {
    return this.http.get<PaymentMethodRow[]>(`${this.base}/`);
  }
}
