import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import type { Product, ProductImage } from '../../../almacen/models/almacen.models';
import { ProductService } from '../../../almacen/services/product.service';
import { ProductImageService } from '../../../almacen/services/product-image.service';

@Component({
  selector: 'app-producto-detail-page',
  imports: [RouterLink],
  templateUrl: './producto-detail-page.component.html',
})
export class ProductoDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly productsApi = inject(ProductService);
  private readonly imagesApi = inject(ProductImageService);
  readonly auth = inject(AuthService);

  readonly product = signal<Product | null>(null);
  readonly images = signal<ProductImage[]>([]);
  readonly loading = signal(false);
  readonly imagesLoading = signal(false);
  readonly uploadBusy = signal(false);
  readonly savingPrimaryId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly uploadName = signal('');
  readonly uploadPrimary = signal(false);
  private file: File | null = null;

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
        filter((id) => !Number.isNaN(id) && id > 0),
        switchMap((id) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          this.product.set(null);
          this.images.set([]);
          return this.productsApi.get(id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (p) => {
          this.product.set(p);
          this.loading.set(false);
          this.loadImages(p.id);
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(this.formatError(err));
        },
      });
  }

  private loadImages(productId: number): void {
    this.imagesLoading.set(true);
    this.imagesApi.listForProduct(productId).subscribe({
      next: (rows) => {
        this.images.set(rows);
        this.imagesLoading.set(false);
      },
      error: (err) => {
        this.imagesLoading.set(false);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    this.file = f ?? null;
  }

  upload(): void {
    const p = this.product();
    if (!p || !this.file) {
      this.errorMessage.set('Selecciona un archivo.');
      return;
    }
    this.uploadBusy.set(true);
    this.errorMessage.set(null);
    const name = this.uploadName().trim();
    this.imagesApi
      .upload(this.file, p.id, {
        name: name || undefined,
        primary: this.uploadPrimary() || undefined,
      })
      .subscribe({
        next: () => {
          this.uploadBusy.set(false);
          this.file = null;
          this.uploadName.set('');
          this.uploadPrimary.set(false);
          this.loadImages(p.id);
        },
        error: (err) => {
          this.uploadBusy.set(false);
          this.errorMessage.set(this.formatError(err));
        },
      });
  }

  setPrimary(img: ProductImage): void {
    if (!this.auth.canWriteAlmacen()) return;
    this.savingPrimaryId.set(img.id);
    this.errorMessage.set(null);
    this.imagesApi.update(img.id, { primary: true }).subscribe({
      next: () => {
        this.savingPrimaryId.set(null);
        const p = this.product();
        if (p) this.loadImages(p.id);
      },
      error: (err) => {
        this.savingPrimaryId.set(null);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  removeImage(img: ProductImage): void {
    if (!this.auth.canWriteAlmacen()) return;
    if (!window.confirm('¿Eliminar esta imagen?')) return;
    this.errorMessage.set(null);
    this.imagesApi.delete(img.id).subscribe({
      next: () => {
        const p = this.product();
        if (p) this.loadImages(p.id);
      },
      error: (err) => this.errorMessage.set(this.formatError(err)),
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error de red';
    }
    return 'Error desconocido';
  }
}
