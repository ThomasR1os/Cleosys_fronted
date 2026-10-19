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
    path: 'solicitudes-proforma',
    loadComponent: () =>
      import('../ventas/pages/proforma-requests/proforma-requests-page.component').then(
        (m) => m.ProformaRequestsPageComponent,
      ),
  },
  {
    path: 'pendientes',
    loadComponent: () =>
      import('../tareas/pages/tasks-inbox/tasks-inbox-page.component').then(
        (m) => m.TasksInboxPageComponent,
      ),
  },
  {
    path: 'ordenes-internas',
    loadComponent: () =>
      import('./pages/logistics-orders/logistics-orders-page.component').then(
        (m) => m.LogisticsOrdersPageComponent,
      ),
  },
  {
    path: 'ordenes-internas/:id',
    loadComponent: () =>
      import('./pages/logistics-orders/logistics-order-detail-page.component').then(
        (m) => m.LogisticsOrderDetailPageComponent,
      ),
  },
  {
    path: 'ordenes-compra',
    loadComponent: () =>
      import('./pages/purchase-orders/purchase-orders-page.component').then(
        (m) => m.PurchaseOrdersPageComponent,
      ),
  },
  {
    path: 'ordenes-compra/nueva',
    loadComponent: () =>
      import('./pages/purchase-orders/purchase-order-editor-page.component').then(
        (m) => m.PurchaseOrderEditorPageComponent,
      ),
  },
  {
    path: 'ordenes-compra/:id',
    loadComponent: () =>
      import('./pages/purchase-orders/purchase-order-editor-page.component').then(
        (m) => m.PurchaseOrderEditorPageComponent,
      ),
  },
  {
    path: 'comparativo',
    loadComponent: () =>
      import('./pages/price-compare/price-compare-page.component').then(
        (m) => m.PriceComparePageComponent,
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
