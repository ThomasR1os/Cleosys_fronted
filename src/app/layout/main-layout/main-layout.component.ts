import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../features/admin/services/company.service';
import {
  DEFAULT_COMPANY_BRANDING,
  hexToRgb,
} from '../../features/admin/utils/company-branding.utils';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './main-layout.component.html',
  styles: `
    .sidebar-branded {
      background-color: var(--sidebar-primary);
      color: var(--sidebar-fg);
    }
    .sidebar-branded .menu a {
      color: var(--sidebar-fg);
    }
    .sidebar-branded .menu a:hover,
    .sidebar-branded .menu a:focus {
      background-color: color-mix(in srgb, var(--sidebar-fg) 12%, transparent);
    }
    .sidebar-branded .menu a.active {
      background-color: color-mix(in srgb, var(--sidebar-fg) 22%, transparent);
      font-weight: 600;
    }
    .sidebar-branded .sidebar-muted {
      color: color-mix(in srgb, var(--sidebar-fg) 72%, transparent);
    }
    .sidebar-branded .sidebar-divider {
      border-color: color-mix(in srgb, var(--sidebar-fg) 22%, transparent);
    }
  `,
})
export class MainLayoutComponent implements OnInit {
  /** Menú fijo solo en escritorio. En tablet queda como overlay para no robar ancho. */
  private static readonly dockedSidebarQuery = '(min-width: 1280px)';

  private readonly auth = inject(AuthService);
  private readonly companies = inject(CompanyService);
  private readonly destroyRef = inject(DestroyRef);

  readonly authService = this.auth;

  readonly dockedSidebar = signal(this.prefersDockedSidebar());
  /** En tablet arranca cerrado para que el contenido use todo el ancho. */
  readonly sidebarOpen = signal(this.prefersDockedSidebar());
  readonly primaryColor = signal(DEFAULT_COMPANY_BRANDING.primary);

  readonly sidebarFg = computed(() => {
    const [r, g, b] = hexToRgb(this.primaryColor());
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
  });

  ngOnInit(): void {
    this.bindSidebarToViewport();
    this.auth
      .loadProfile()
      .pipe(
        switchMap((me) => {
          const companyId = me.profile?.company?.id;
          if (companyId == null) return of(null);
          return this.companies.retrieve(companyId).pipe(catchError(() => of(null)));
        }),
      )
      .subscribe({
        next: (company) => {
          const primary =
            company?.branding?.primary?.trim() || DEFAULT_COMPANY_BRANDING.primary;
          this.primaryColor.set(primary);
        },
        error: () => {
          /* 401: interceptor intenta refresh o cierra sesión */
        },
      });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  private prefersDockedSidebar(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MainLayoutComponent.dockedSidebarQuery).matches
    );
  }

  private bindSidebarToViewport(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MainLayoutComponent.dockedSidebarQuery);
    const apply = () => {
      const docked = query.matches;
      this.dockedSidebar.set(docked);
      this.sidebarOpen.set(docked);
    };
    apply();
    query.addEventListener('change', apply);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', apply));
  }

  onDrawerToggle(event: Event): void {
    this.sidebarOpen.set((event.target as HTMLInputElement).checked);
  }

  logout(): void {
    this.auth.logout();
  }
}
