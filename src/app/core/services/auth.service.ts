import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  firstValueFrom,
  from,
  map,
  tap,
  throwError,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import type { MeResponse, TokenPair } from '../models/auth.models';

const STORAGE_ACCESS = 'cleosystem_access';
const STORAGE_REFRESH = 'cleosystem_refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly httpBackend = inject(HttpBackend);
  /** Cliente sin interceptores (refresh y login). */
  private readonly httpRaw = new HttpClient(this.httpBackend);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly refreshToken = signal<string | null>(null);

  /** Evita varias renovaciones en paralelo (p. ej. muchas peticiones 401 a la vez). */
  private refreshPromise: Promise<void> | null = null;

  /** Sesión devuelta por /api/auth/me/. */
  readonly me = signal<MeResponse | null>(null);

  readonly isAuthenticated = computed(() => !!this.accessToken());

  readonly companyName = computed(
    () => this.me()?.profile?.company?.name ?? '—',
  );

  /** Nombre para mostrar en cabeceras y dashboard. */
  readonly displayName = computed(() => {
    const u = this.me()?.user;
    if (!u) return '';
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return full || u.username;
  });

  readonly roleLabel = computed(() => this.me()?.profile?.role ?? '—');

  readonly quotationPrefix = computed(
    () => this.me()?.profile?.quotation_prefix ?? '—',
  );

  /** POST/PATCH/DELETE en recursos de almacén (según AlmacenWritePermission en backend). */
  readonly canWriteAlmacen = computed(() => {
    const role = this.me()?.profile?.role;
    return role === 'ALMACEN' || role === 'ADMIN';
  });

  /** POST/PATCH/DELETE en logística (LogisticaWritePermission). */
  readonly canWriteLogistica = computed(() => {
    const role = this.me()?.profile?.role;
    return role === 'LOGISTICA' || role === 'ADMIN';
  });

  readonly isAdmin = computed(() => this.me()?.profile?.role === 'ADMIN');

  constructor() {
    this.hydrateFromStorage();
  }

  private hydrateFromStorage(): void {
    const access = localStorage.getItem(STORAGE_ACCESS);
    const refresh = localStorage.getItem(STORAGE_REFRESH);
    if (access) this.accessToken.set(access);
    if (refresh) this.refreshToken.set(refresh);
  }

  accessTokenValue(): string | null {
    return this.accessToken();
  }

  /** Persiste tokens y actualiza señales. */
  setTokens(pair: TokenPair): void {
    this.accessToken.set(pair.access);
    this.refreshToken.set(pair.refresh);
    localStorage.setItem(STORAGE_ACCESS, pair.access);
    localStorage.setItem(STORAGE_REFRESH, pair.refresh);
  }

  login(username: string, password: string): Observable<void> {
    const url = `${environment.apiUrl}/auth/token/`;
    return this.httpRaw.post<TokenPair>(url, { username, password }).pipe(
      tap((pair) => this.setTokens(pair)),
      map(() => undefined),
    );
  }

  loadProfile(): Observable<MeResponse> {
    const url = `${environment.apiUrl}/auth/me/`;
    return this.http.get<MeResponse>(url).pipe(
      tap((data) => this.me.set(data)),
      catchError((err) => {
        this.me.set(null);
        return throwError(() => err);
      }),
    );
  }

  /**
   * Renueva el access token; usa HttpClient sin interceptores para evitar ciclos.
   * Si el backend rota el refresh (SimpleJWT con ROTATE_REFRESH_TOKENS), persiste el nuevo refresh.
   */
  refreshAccessToken(): Observable<void> {
    const refresh = this.refreshToken();
    if (!refresh) {
      return throwError(() => new Error('Sin refresh token'));
    }
    if (!this.refreshPromise) {
      const url = `${environment.apiUrl}/auth/token/refresh/`;
      this.refreshPromise = firstValueFrom(
        this.httpRaw
          .post<{ access: string; refresh?: string }>(url, { refresh })
          .pipe(
            tap((res) => {
              this.accessToken.set(res.access);
              localStorage.setItem(STORAGE_ACCESS, res.access);
              if (res.refresh) {
                this.refreshToken.set(res.refresh);
                localStorage.setItem(STORAGE_REFRESH, res.refresh);
              }
            }),
            map(() => undefined),
          ),
      ).finally(() => {
        this.refreshPromise = null;
      });
    }
    return from(this.refreshPromise);
  }

  logout(): void {
    this.accessToken.set(null);
    this.refreshToken.set(null);
    this.me.set(null);
    localStorage.removeItem(STORAGE_ACCESS);
    localStorage.removeItem(STORAGE_REFRESH);
    void this.router.navigate(['/login']);
  }
}
