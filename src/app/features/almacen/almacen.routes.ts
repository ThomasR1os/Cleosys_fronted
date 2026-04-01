import { Routes } from '@angular/router';

export const ALMACEN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/almacen-hub/almacen-hub.component').then((m) => m.AlmacenHubComponent),
  },
  {
    path: 'almacenes',
    loadComponent: () =>
      import('./pages/warehouses/warehouses-page.component').then((m) => m.WarehousesPageComponent),
  },
  {
    path: 'almacenes/:warehouseId/stock',
    loadComponent: () =>
      import('./pages/warehouse-stock/warehouse-stock.component').then(
        (m) => m.WarehouseStockComponent,
      ),
  },
  {
    path: 'movimientos',
    loadComponent: () =>
      import('./pages/movements/movements-page.component').then((m) => m.MovementsPageComponent),
  },
];
