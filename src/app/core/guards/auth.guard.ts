import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  if (auth.me() !== null) {
    return true;
  }
  return auth.loadProfile().pipe(
    map(() => true),
    catchError(() => of(true)),
  );
};

/** Evita ver el login si ya hay sesión. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    return true;
  }

  const home = (): ReturnType<Router['createUrlTree']> =>
    router.createUrlTree([
      auth.me()?.profile?.role === 'TECNICO' ? '/servicios' : '/inicio',
    ]);

  if (auth.me() !== null) {
    return home();
  }

  return auth.loadProfile().pipe(
    map(() => home()),
    catchError(() => of(router.createUrlTree(['/inicio']))),
  );
};
