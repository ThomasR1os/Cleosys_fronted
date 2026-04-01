import { Routes } from '@angular/router';
import { clientContactsAccessGuard } from './guards/client-contacts-access.guard';

export const VENTAS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/ventas-hub/ventas-hub.component').then((m) => m.VentasHubComponent),
  },
  {
    path: 'clientes',
    loadComponent: () =>
      import('./pages/clients/clients-page.component').then((m) => m.ClientsPageComponent),
  },
  {
    path: 'contactos',
    canActivate: [clientContactsAccessGuard],
    loadComponent: () =>
      import('./pages/client-contacts/client-contacts-page.component').then(
        (m) => m.ClientContactsPageComponent,
      ),
  },
  {
    path: 'cotizaciones',
    loadComponent: () =>
      import('./pages/quotations/quotations-page.component').then((m) => m.QuotationsPageComponent),
  },
];
