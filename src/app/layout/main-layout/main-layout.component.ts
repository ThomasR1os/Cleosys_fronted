import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './main-layout.component.html',
})
export class MainLayoutComponent implements OnInit {
  private readonly auth = inject(AuthService);

  readonly authService = this.auth;

  ngOnInit(): void {
    this.auth.loadProfile().subscribe({
      error: () => {
        /* 401: interceptor intenta refresh o cierra sesión */
      },
    });
  }

  logout(): void {
    this.auth.logout();
  }
}
