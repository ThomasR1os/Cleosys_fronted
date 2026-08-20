import { Routes } from '@angular/router';

export const SERVICIOS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/servicios-hub/servicios-hub.component').then((m) => m.ServiciosHubComponent),
  },
  {
    path: 'maquinarias',
    loadComponent: () =>
      import('./pages/maquinarias/maquinarias-page.component').then(
        (m) => m.MaquinariasPageComponent,
      ),
  },
];
