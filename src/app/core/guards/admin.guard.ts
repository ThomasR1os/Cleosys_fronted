import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Solo usuarios con perfil `ADMIN` (tras cargar `/api/auth/me/` si hace falta). */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  const allowOrRedirect = (): boolean | ReturnType<Router['createUrlTree']> =>
    auth.isAdmin() ? true : router.createUrlTree(['/inicio']);

  if (auth.me() !== null) {
    return allowOrRedirect();
  }

  return auth.loadProfile().pipe(
    map(() => allowOrRedirect()),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
