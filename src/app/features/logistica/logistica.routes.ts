import { Routes } from '@angular/router';

export const LOGISTICA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/logistica-hub/logistica-hub.component').then((m) => m.LogisticaHubComponent),
  },
  {
    path: 'tareas',
    loadComponent: () =>
      import('./pages/logistic-tasks/logistic-tasks-page.component').then(
        (m) => m.LogisticTasksPageComponent,
      ),
  },
  {
    path: 'producto-proveedor',
    loadComponent: () =>
      import('./pages/product-suppliers/product-suppliers-page.component').then(
        (m) => m.ProductSuppliersPageComponent,
      ),
  },
];
