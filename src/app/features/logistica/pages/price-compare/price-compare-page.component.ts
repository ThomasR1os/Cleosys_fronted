import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { formatHttpError } from '../../../../core/utils/api-errors.utils';
import { textMatchesLooseQuery } from '../../../../core/utils/text-search.utils';
import type { AlmacenProduct } from '../../../almacen/models/almacen.models';
import { AlmacenProductService } from '../../../almacen/services/almacen-product.service';
import type { Supplier } from '../../../core/models/supplier.model';
import { SupplierService } from '../../../core/services/supplier.service';
import type { ProductSupplierMoney, ProductSupplierRow } from '../../models/logistica.models';
import { formatPurchaseMoney } from '../../models/purchase-order.models';
import { ProductSupplierService } from '../../services/product-supplier.service';

interface SelectedProduct {
  id: number;
  sku: string;
  description: string;
  qty: number;
}

interface SupplierColumn {
  id: number;
  name: string;
  typeLabel: string;
}

interface CellView {
  priceLabel: string;
  lineLabel: string | null;
  lineAmount: number;
  money: ProductSupplierMoney;
  incoterm: string;
  best: boolean;
}

interface TotalPartView {
  label: string;
  winner: boolean;
}

interface RowView {
  id: number;
  sku: string;
  description: string;
  qty: number;
  cells: (CellView | null)[];
  quoted: number;
}

interface ColumnTotalView {
  coversAll: boolean;
  missing: number;
  parts: TotalPartView[];
}

@Component({
  selector: 'app-price-compare-page',
  imports: [RouterLink],
  templateUrl: './price-compare-page.component.html',
})
export class PriceComparePageComponent implements OnInit {
  private readonly linksApi = inject(ProductSupplierService);
  private readonly productsApi = inject(AlmacenProductService);
  private readonly suppliersApi = inject(SupplierService);

  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly products = signal<AlmacenProduct[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly links = signal<ProductSupplierRow[]>([]);
  readonly selected = signal<SelectedProduct[]>([]);
  readonly onlyComplete = signal(false);
  readonly productQuery = signal('');
  readonly productMenuOpen = signal(false);

  readonly productMatches = computed(() => {
    const taken = new Set(this.selected().map((row) => row.id));
    const query = this.productQuery().trim();
    const rows = this.products().filter((product) => !taken.has(product.id));
    const filtered = query
      ? rows.filter((product) =>
          textMatchesLooseQuery(`${product.sku} ${product.description} ${product.id}`, query),
        )
      : rows;
    return filtered.slice(0, 20);
  });

  readonly comparison = computed(() => {
    const selected = this.selected();
    const offers = indexOffers(this.links());
    const supplierById = new Map(this.suppliers().map((supplier) => [supplier.id, supplier]));
    const columns = supplierColumns(selected, offers, supplierById, this.onlyComplete());
    const rows = selected.map((product) => buildRow(product, columns, offers));
    const totals = buildTotals(rows);
    return { columns, rows, totals };
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    forkJoin({
      links: this.linksApi.list(),
      products: this.productsApi.list(),
      suppliers: this.suppliersApi.list(),
    }).subscribe({
      next: ({ links, products, suppliers }) => {
        this.links.set(links);
        this.products.set([...products].sort((a, b) => a.sku.localeCompare(b.sku, 'es')));
        this.suppliers.set(suppliers);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(formatHttpError(err, 'No se pudieron cargar los costos de proveedor.'));
      },
    });
  }

  onProductQuery(value: string): void {
    this.productQuery.set(value);
    this.productMenuOpen.set(true);
  }

  openProductMenu(): void {
    this.productMenuOpen.set(true);
  }

  closeProductMenuSoon(): void {
    window.setTimeout(() => this.productMenuOpen.set(false), 180);
  }

  addProduct(product: AlmacenProduct, event?: Event): void {
    event?.preventDefault();
    this.selected.update((rows) => {
      if (rows.some((row) => row.id === product.id)) return rows;
      return [
        ...rows,
        { id: product.id, sku: product.sku, description: product.description, qty: 1 },
      ];
    });
    this.productQuery.set('');
    this.productMenuOpen.set(false);
  }

  removeProduct(productId: number): void {
    this.selected.update((rows) => rows.filter((row) => row.id !== productId));
  }

  clearProducts(): void {
    this.selected.set([]);
  }

  setQty(productId: number, input: HTMLInputElement): void {
    const n = Number(input.value.replace(',', '.'));
    const qty = Number.isFinite(n) && n > 0 ? roundQty(n) : 1;
    input.value = String(qty);
    this.selected.update((rows) => rows.map((row) => (row.id === productId ? { ...row, qty } : row)));
  }

  toggleOnlyComplete(checked: boolean): void {
    this.onlyComplete.set(checked);
  }
}

function indexOffers(links: ProductSupplierRow[]): Map<number, Map<number, ProductSupplierRow>> {
  const index = new Map<number, Map<number, ProductSupplierRow>>();
  for (const link of links) {
    let bySupplier = index.get(link.product);
    if (!bySupplier) {
      bySupplier = new Map();
      index.set(link.product, bySupplier);
    }
    const previous = bySupplier.get(link.supplier);
    if (!previous || link.id >= previous.id) bySupplier.set(link.supplier, link);
  }
  return index;
}

function supplierColumns(
  selected: SelectedProduct[],
  offers: Map<number, Map<number, ProductSupplierRow>>,
  supplierById: Map<number, Supplier>,
  onlyComplete: boolean,
): SupplierColumn[] {
  const ids = new Set<number>();
  for (const product of selected) {
    const bySupplier = offers.get(product.id);
    if (!bySupplier) continue;
    for (const supplierId of bySupplier.keys()) ids.add(supplierId);
  }
  let columns = [...ids].map((id) => {
    const supplier = supplierById.get(id);
    return {
      id,
      name: supplier?.name ?? `Proveedor #${id}`,
      typeLabel: supplier ? (supplier.type === 'EXTRANJERO' ? 'Extranjero' : 'Nacional') : '',
    };
  });
  if (onlyComplete) {
    columns = columns.filter((column) =>
      selected.every((product) => offers.get(product.id)?.has(column.id)),
    );
  }
  columns.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return columns;
}

function buildRow(
  product: SelectedProduct,
  columns: SupplierColumn[],
  offers: Map<number, Map<number, ProductSupplierRow>>,
): RowView {
  const bySupplier = offers.get(product.id);
  const raw = columns.map((column) => bySupplier?.get(column.id) ?? null);
  const bestKeys = cheapestKeys(raw);
  const cells = raw.map((link, index) => {
    if (!link) return null;
    const cost = costAmount(link.cost);
    if (!Number.isFinite(cost)) return null;
    const lineTotal = round2(cost * product.qty);
    return {
      priceLabel: formatPurchaseMoney(cost, link.money),
      lineLabel: product.qty === 1 ? null : formatPurchaseMoney(lineTotal, link.money),
      lineAmount: lineTotal,
      money: link.money,
      incoterm: link.incoterm.trim(),
      best: bestKeys.has(index),
    };
  });
  return {
    id: product.id,
    sku: product.sku,
    description: product.description,
    qty: product.qty,
    cells,
    quoted: cells.filter((cell) => cell != null).length,
  };
}

function cheapestKeys(links: (ProductSupplierRow | null)[]): Set<number> {
  const best = new Map<ProductSupplierMoney, { cost: number; indexes: number[] }>();
  links.forEach((link, index) => {
    if (!link) return;
    const cost = costAmount(link.cost);
    if (!Number.isFinite(cost)) return;
    const current = best.get(link.money);
    if (!current || cost < current.cost) {
      best.set(link.money, { cost, indexes: [index] });
    } else if (cost === current.cost) {
      current.indexes.push(index);
    }
  });
  const keys = new Set<number>();
  for (const entry of best.values()) {
    for (const index of entry.indexes) keys.add(index);
  }
  return keys;
}

function buildTotals(rows: RowView[]): ColumnTotalView[] {
  const width = rows[0]?.cells.length ?? 0;
  const buckets = Array.from({ length: width }, () => new Map<ProductSupplierMoney, number>());
  const covered = Array.from({ length: width }, () => 0);
  for (const row of rows) {
    row.cells.forEach((cell, index) => {
      if (!cell) return;
      buckets[index].set(cell.money, round2((buckets[index].get(cell.money) ?? 0) + cell.lineAmount));
      covered[index] += 1;
    });
  }

  const winners = new Map<ProductSupplierMoney, { amount: number; indexes: number[] }>();
  buckets.forEach((bucket, index) => {
    if (rows.length === 0 || covered[index] !== rows.length || bucket.size !== 1) return;
    const [money, amount] = [...bucket.entries()][0];
    const current = winners.get(money);
    if (!current || amount < current.amount) {
      winners.set(money, { amount, indexes: [index] });
    } else if (amount === current.amount) {
      current.indexes.push(index);
    }
  });
  const winnerKeys = new Set<string>();
  for (const [money, entry] of winners) {
    for (const index of entry.indexes) winnerKeys.add(`${index}:${money}`);
  }

  return buckets.map((bucket, index) => ({
    coversAll: rows.length > 0 && covered[index] === rows.length,
    missing: Math.max(rows.length - covered[index], 0),
    parts: [...bucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([money, amount]) => ({
        label: formatPurchaseMoney(amount, money),
        winner: winnerKeys.has(`${index}:${money}`),
      })),
  }));
}

function costAmount(value: string): number {
  const n = Number(String(value).replace(',', '.').trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
