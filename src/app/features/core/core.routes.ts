import { Routes } from '@angular/router';

export const CORE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/core-hub/core-hub.component').then((m) => m.CoreHubComponent),
  },
  {
    path: 'proveedores',
    loadComponent: () =>
      import('./pages/suppliers/suppliers-page.component').then((m) => m.SuppliersPageComponent),
  },
  {
    path: 'marcas',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'brands' },
  },
  {
    path: 'categorias',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'categories' },
  },
  {
    path: 'subcategorias',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'subcategories' },
  },
  {
    path: 'tipos-producto',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'types' },
  },
  {
    path: 'unidades',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'units' },
  },
  {
    path: 'metodos-pago',
    loadComponent: () =>
      import('./pages/simple-catalog/simple-catalog-page.component').then(
        (m) => m.SimpleCatalogPageComponent,
      ),
    data: { catalogKey: 'payment-methods' },
  },
  {
    path: 'productos',
    loadComponent: () =>
      import('./pages/productos/productos-page.component').then((m) => m.ProductosPageComponent),
  },
  {
    path: 'productos/:id',
    loadComponent: () =>
      import('./pages/productos/producto-detail-page.component').then(
        (m) => m.ProductoDetailPageComponent,
      ),
  },
];
