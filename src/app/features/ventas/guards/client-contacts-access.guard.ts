import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

/** Solo acceso con `?cliente=` válido (desde la fila en Clientes). */
export const clientContactsAccessGuard: CanActivateFn = (route) => {
  const raw = route.queryParamMap.get('cliente');
  if (raw == null || raw === '') {
    return inject(Router).createUrlTree(['/ventas', 'clientes']);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return inject(Router).createUrlTree(['/ventas', 'clientes']);
  }
  return true;
};
