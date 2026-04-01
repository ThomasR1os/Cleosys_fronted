import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

function isAuthPath(url: string): boolean {
  return (
    url.includes('/auth/token/') ||
    url.includes('/auth/token/refresh/')
  );
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (isAuthPath(req.url)) {
    return next(req);
  }

  const token = auth.accessTokenValue();
  let authReq = req;
  if (token) {
    authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }
      if (isAuthPath(req.url)) {
        return throwError(() => err);
      }
      return auth.refreshAccessToken().pipe(
        switchMap(() => {
          const newToken = auth.accessTokenValue();
          if (!newToken) {
            auth.logout();
            return throwError(() => err);
          }
          const retry = req.clone({
            setHeaders: { Authorization: `Bearer ${newToken}` },
          });
          return next(retry);
        }),
        catchError(() => {
          auth.logout();
          void router.navigate(['/login']);
          return throwError(() => err);
        }),
      );
    }),
  );
};
