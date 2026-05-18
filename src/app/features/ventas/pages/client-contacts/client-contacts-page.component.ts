import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import type { AdminUser } from '../../../admin/models/admin-users.models';
import { AdminUserService } from '../../../admin/services/admin-user.service';
import type { AssignableUser, ClientContactRow, ClientRow } from '../../models/ventas.models';
import { ClientContactService } from '../../services/client-contact.service';
import { ClientService } from '../../services/client.service';
import { ProformaRequestService } from '../../services/proforma-request.service';

const MASK = '****';

@Component({
  selector: 'app-client-contacts-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './client-contacts-page.component.html',
})
export class ClientContactsPageComponent implements OnInit {
  private readonly api = inject(ClientContactService);
  private readonly clientsApi = inject(ClientService);
  private readonly adminUsers = inject(AdminUserService);
  private readonly proformaApi = inject(ProformaRequestService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  readonly items = signal<ClientContactRow[]>([]);
  /** Nombres para ids de usuario cuando el contacto no trae `encargado.nombre` ni `owner_user`. */
  readonly userLabelById = signal<ReadonlyMap<number, string>>(new Map());
  readonly clientRow = signal<ClientRow | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingRow = signal<ClientContactRow | null>(null);
  readonly staffOptions = signal<AdminUser[]>([]);
  readonly assignableUsers = signal<AssignableUser[]>([]);

  /** Opciones del selector de encargado (admin: usuarios; ventas: asignables). */
  readonly encargadoSelectOptions = computed(() => {
    const opts: { id: number; label: string }[] = this.auth.isAdmin()
      ? this.staffOptions().map((u) => ({ id: u.id, label: this.formatStaffName(u) }))
      : this.assignableUsers().map((u) => ({ id: u.id, label: u.nombre }));
    const row = this.editingRow();
    const currentId = row?.user ?? row?.owner ?? null;
    if (currentId != null && !opts.some((o) => o.id === currentId)) {
      opts.push({
        id: currentId,
        label: this.userLabelById().get(currentId) ?? `Usuario #${currentId}`,
      });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
  });

  /** IDs de filas con email/teléfono visibles (solo si `canRevealContact`). */
  readonly revealedIds = signal<ReadonlySet<number>>(new Set<number>());

  readonly form = this.fb.nonNullable.group({
    contact_first_name: ['', Validators.required],
    contact_last_name: ['', Validators.required],
    email: [''],
    phone: [''],
    user: this.fb.control<number | null>(null),
  });

  readonly myUserId = computed(() => this.auth.me()?.user?.id ?? null);

  readonly filterClientId = toSignal(
    this.route.queryParamMap.pipe(
      map((q) => {
        const raw = q.get('cliente');
        if (raw == null || raw === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }),
    ),
    { initialValue: null },
  );

  ngOnInit(): void {
    this.adminUsers.list().subscribe({
      next: (users) => {
        this.staffOptions.set(users);
        const m = new Map<number, string>();
        for (const u of users) {
          m.set(u.id, this.formatStaffName(u));
        }
        this.userLabelById.set(m);
      },
      error: () => {
        this.staffOptions.set([]);
        this.userLabelById.set(new Map());
      },
    });
    this.proformaApi.assignableUsers().subscribe({
      next: (users) =>
        this.assignableUsers.set(
          [...users].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
        ),
      error: () => this.assignableUsers.set([]),
    });
    this.reload();
  }

  private formatStaffName(u: AdminUser): string {
    const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return full || u.username || `Usuario #${u.id}`;
  }

  /** Si solo viene el id numérico y no está en el directorio, intenta GET usuario por id. */
  private hydrateMissingUserLabels(rows: ClientContactRow[]): void {
    const need = new Set<number>();
    const known = this.userLabelById();
    const me = this.auth.me()?.user;
    for (const r of rows) {
      if (r.owner_user) continue;
      if (r.encargado?.nombre?.trim()) continue;
      const id = r.user ?? r.owner;
      if (id == null) continue;
      if (known.has(id)) continue;
      if (me?.id === id) continue;
      need.add(id);
    }
    if (need.size === 0) return;
    const ids = [...need];
    forkJoin(
      ids.map((id) =>
        this.adminUsers.retrieve(id).pipe(catchError(() => of<AdminUser | null>(null))),
      ),
    ).subscribe((users) => {
      this.userLabelById.update((prev) => {
        const m = new Map(prev);
        for (const u of users) {
          if (u) m.set(u.id, this.formatStaffName(u));
        }
        return m;
      });
    });
  }

  reload(): void {
    const raw = this.route.snapshot.queryParamMap.get('cliente');
    const clientId = raw ? Number(raw) : NaN;
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.revealedIds.set(new Set());
    this.clientRow.set(null);

    forkJoin({
      client: this.clientsApi.retrieve(clientId).pipe(catchError(() => of<ClientRow | null>(null))),
      contacts: this.api.listForClient(clientId),
    }).subscribe({
      next: ({ client, contacts }) => {
        this.clientRow.set(client);
        const scoped = contacts.filter((r) => r.client === clientId);
        this.items.set([...scoped].sort((a, b) => b.id - a.id));
        this.loading.set(false);
        this.hydrateMissingUserLabels(scoped);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /** Misma regla que ver datos sensibles: admin o vendedor asignado al contacto. */
  canEditContact(row: ClientContactRow): boolean {
    return this.canRevealContact(row);
  }

  openEdit(row: ClientContactRow): void {
    if (!this.canEditContact(row)) return;
    this.editingRow.set(row);
    this.errorMessage.set(null);
    this.form.patchValue({
      contact_first_name: row.contact_first_name ?? '',
      contact_last_name: row.contact_last_name ?? '',
      email: row.email?.trim() ?? '',
      phone: row.phone?.trim() ?? '',
      user: row.user ?? row.owner ?? null,
    });
    this.revealedIds.update((prev) => {
      const next = new Set(prev);
      next.add(row.id);
      return next;
    });
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingRow.set(null);
  }

  save(): void {
    const row = this.editingRow();
    if (!row || !this.canEditContact(row)) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const body: Parameters<ClientContactService['patch']>[1] = {
      contact_first_name: v.contact_first_name.trim(),
      contact_last_name: v.contact_last_name.trim(),
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
    };
    body.user = v.user != null && v.user > 0 ? v.user : null;

    this.saving.set(true);
    this.errorMessage.set(null);
    this.api.patch(row.id, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(this.fmt(err));
      },
    });
  }

  /**
   * Email/teléfono: administradores o el vendedor asignado a ese contacto (`user` / `owner_user`).
   */
  canRevealContact(row: ClientContactRow): boolean {
    if (this.auth.isAdmin()) return true;
    const me = this.myUserId();
    if (me == null) return false;
    const primary = row.user ?? row.owner ?? null;
    if (primary != null && primary === me) return true;
    const extra = row.users_with_access;
    if (Array.isArray(extra) && extra.includes(me)) return true;
    return false;
  }

  toggleReveal(row: ClientContactRow): void {
    if (!this.canRevealContact(row)) return;
    const id = row.id;
    this.revealedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isRevealed(row: ClientContactRow): boolean {
    return this.revealedIds().has(row.id);
  }

  revealButtonLabel(row: ClientContactRow): string {
    return this.isRevealed(row) ? 'Ocultar datos' : 'Mostrar datos';
  }

  displayEmail(row: ClientContactRow): string {
    const v = row.email?.trim();
    if (!v) return '—';
    if (!this.canRevealContact(row)) return MASK;
    return this.isRevealed(row) ? v : MASK;
  }

  displayPhone(row: ClientContactRow): string {
    const v = row.phone?.trim();
    if (!v) return '—';
    if (!this.canRevealContact(row)) return MASK;
    return this.isRevealed(row) ? v : MASK;
  }

  /** Razón social del cliente (fila o cabecera cargada). */
  clientNombreDisplay(row: ClientContactRow): string {
    const d = row.client_detail;
    if (d?.name?.trim()) return d.name.trim();
    const cl = this.clientRow();
    return cl?.name?.trim() || `Cliente #${row.client}`;
  }

  /** Vendedor / encargado asignado a este contacto. */
  encargadoLabel(row: ClientContactRow): string {
    const nombreApi = row.encargado?.nombre?.trim();
    if (nombreApi) return nombreApi;
    const u = row.owner_user;
    if (u) {
      const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      return full || u.username || `Usuario #${u.id}`;
    }
    const id = row.user ?? row.owner;
    if (id == null) return '—';
    const fromDirectory = this.userLabelById().get(id);
    if (fromDirectory) return fromDirectory;
    const me = this.auth.me()?.user;
    if (me && me.id === id) {
      const full = [me.first_name, me.last_name].filter(Boolean).join(' ').trim();
      return full || me.username || `Usuario #${id}`;
    }
    return `Usuario #${id}`;
  }

  contactFullName(row: ClientContactRow): string {
    return [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ').trim() || '—';
  }

  private fmt(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const d = err.error;
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        if ('detail' in d && typeof d.detail === 'string') return d.detail;
        const parts: string[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (k === 'detail') continue;
          if (typeof v === 'string') parts.push(`${k}: ${v}`);
          else if (Array.isArray(v) && typeof v[0] === 'string') parts.push(`${k}: ${v[0]}`);
        }
        if (parts.length) return parts.join(' · ');
        const first = Object.values(d)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
        if (typeof first === 'string') return first;
      }
      return err.message || 'Error';
    }
    return 'Error desconocido';
  }
}
