import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { AlmacenProduct, Warehouse, WarehouseProduct } from '../../models/almacen.models';
import { AlmacenProductService } from '../../services/almacen-product.service';
import { WarehouseProductService } from '../../services/warehouse-product.service';
import { WarehouseService } from '../../services/warehouse.service';

@Component({
  selector: 'app-warehouse-stock',
  imports: [RouterLink],
  templateUrl: './warehouse-stock.component.html',
})
export class WarehouseStockComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly warehousesApi = inject(WarehouseService);
  private readonly wpApi = inject(WarehouseProductService);
  private   readonly productsApi = inject(AlmacenProductService);

  readonly warehouse = signal<Warehouse | null>(null);
  readonly rows = signal<WarehouseProduct[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private readonly productMap = signal<Map<number, AlmacenProduct>>(new Map());

  readonly sku = (productId: number): string =>
    this.productMap().get(productId)?.sku ?? '—';

  readonly description = (productId: number): string =>
    this.productMap().get(productId)?.description ?? '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('warehouseId');
    const wid = id ? Number(id) : NaN;
    if (Number.isNaN(wid)) {
      this.errorMessage.set('ID de almacén no válido.');
      return;
    }
    this.load(wid);
  }

  private load(wid: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      w: this.warehousesApi.retrieve(wid),
      wps: this.wpApi.list(),
      products: this.productsApi.list(),
    }).subscribe({
      next: ({ w, wps, products }) => {
        this.warehouse.set(w);
        const pmap = new Map<number, AlmacenProduct>();
        for (const p of products) {
          pmap.set(p.id, p);
        }
        this.productMap.set(pmap);
        const filtered = wps.filter((x) => x.warehouse === wid);
        this.rows.set(filtered);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && 'detail' in d && typeof d.detail === 'string') {
        return d.detail;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
