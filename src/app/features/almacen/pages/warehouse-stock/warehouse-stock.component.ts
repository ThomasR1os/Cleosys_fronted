import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
  private readonly productsApi = inject(AlmacenProductService);

  readonly warehouse = signal<Warehouse | null>(null);
  readonly rows = signal<WarehouseProduct[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50] as const;

  private readonly productMap = signal<Map<number, AlmacenProduct>>(new Map());

  readonly sku = (productId: number): string =>
    this.productMap().get(productId)?.sku ?? '—';

  readonly description = (productId: number): string =>
    this.productMap().get(productId)?.description ?? '';

  readonly filteredRows = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const map = this.productMap();
    const rows = this.rows();
    if (!q) return rows;
    return rows.filter((row) => {
      const product = map.get(row.product);
      const blob = [
        String(row.product),
        product?.sku ?? '',
        product?.description ?? '',
        row.location,
        String(row.stock),
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  });

  readonly lineCount = computed(() => this.rows().length);
  readonly unitTotal = computed(() =>
    this.rows().reduce((sum, row) => sum + (Number.isFinite(row.stock) ? row.stock : 0), 0),
  );
  readonly totalCount = computed(() => this.filteredRows().length);
  readonly totalPages = computed(() => {
    const count = this.totalCount();
    if (count === 0) return 0;
    return Math.ceil(count / this.pageSize());
  });
  readonly pagedRows = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredRows().slice(start, start + this.pageSize());
  });
  readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() =>
    Math.min((this.pageIndex() + 1) * this.pageSize(), this.totalCount()),
  );
  readonly hasActiveSearch = computed(() => this.searchQuery().trim().length > 0);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('warehouseId');
    const wid = id ? Number(id) : NaN;
    if (Number.isNaN(wid)) {
      this.errorMessage.set('ID de almacén no válido.');
      return;
    }
    this.load(wid);
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.pageIndex.set(0);
  }

  setPageSize(size: number): void {
    if (!this.pageSizeOptions.includes(size as (typeof this.pageSizeOptions)[number])) return;
    this.pageSize.set(size);
    this.pageIndex.set(0);
  }

  prevPage(): void {
    this.pageIndex.update((index) => Math.max(0, index - 1));
  }

  nextPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    this.pageIndex.update((index) => Math.min(last, index + 1));
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
        this.rows.set(wps.filter((x) => x.warehouse === wid));
        this.loading.set(false);
        this.clampPage();
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  private clampPage(): void {
    const last = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex() > last) this.pageIndex.set(last);
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
