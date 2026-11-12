import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Rol TECNICO: solo rutas bajo `/servicios`. El resto redirige ahí. */
export const tecnicoServiciosGuard: CanActivateChildFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const allowOrRedirect = (): boolean | ReturnType<Router['createUrlTree']> => {
    if (auth.me()?.profile?.role !== 'TECNICO') return true;
    const path = state.url.split('?')[0].split('#')[0];
    if (path === '/servicios' || path.startsWith('/servicios/')) return true;
    return router.createUrlTree(['/servicios']);
  };

  if (auth.me() !== null) {
    return allowOrRedirect();
  }

  return auth.loadProfile().pipe(
    map(() => allowOrRedirect()),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
