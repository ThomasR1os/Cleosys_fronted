import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/main-layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'perfil',
        loadComponent: () =>
          import('./features/profile/pages/my-profile/my-profile-page.component').then(
            (m) => m.MyProfilePageComponent,
          ),
      },
      {
        path: 'core',
        loadChildren: () =>
          import('./features/core/core.routes').then((m) => m.CORE_ROUTES),
      },
      {
        path: 'almacen',
        loadChildren: () =>
          import('./features/almacen/almacen.routes').then((m) => m.ALMACEN_ROUTES),
      },
      {
        path: 'logistica',
        loadChildren: () =>
          import('./features/logistica/logistica.routes').then((m) => m.LOGISTICA_ROUTES),
      },
      {
        path: 'ventas',
        loadChildren: () =>
          import('./features/ventas/ventas.routes').then((m) => m.VENTAS_ROUTES),
      },
      {
        path: 'admin/usuarios',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/admin/pages/users/users-page.component').then(
            (m) => m.UsersPageComponent,
          ),
      },
      {
        path: 'admin/empresas',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/admin/pages/companies/companies-page.component').then(
            (m) => m.CompaniesPageComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
