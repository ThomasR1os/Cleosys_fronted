import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import type { AlmacenProduct } from '../models/almacen.models';
import { ProductService } from './product.service';

@Injectable({ providedIn: 'root' })
export class AlmacenProductService {
  private readonly products = inject(ProductService);

  list(): Observable<AlmacenProduct[]> {
    return this.products.list().pipe(
      map((rows) =>
        rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          description: p.description,
        })),
      ),
    );
  }
}
