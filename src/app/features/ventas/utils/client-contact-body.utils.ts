import type {
  ClientContactCreatePayload,
  ClientContactPatchPayload,
} from '../models/ventas.models';
import { coerceUserPk } from './user-pk.utils';

/** Cuerpo seguro para POST/PATCH de contactos: solo ids numéricos en FKs de usuario. */
export function sanitizeClientContactBody<
  T extends ClientContactCreatePayload | ClientContactPatchPayload,
>(body: T): T {
  const out = { ...body } as T & { user?: number; owner?: number };
  if (out.user != null) {
    const pk = coerceUserPk(out.user);
    if (pk != null) out.user = pk;
    else delete out.user;
  }
  if (out.owner != null) {
    const pk = coerceUserPk(out.owner);
    if (pk != null) out.owner = pk;
    else delete out.owner;
  }
  return out as T;
}

/** Asignación de vendedor al contacto según ids del listado assignable-users. */
export function contactAdvisorAssignBody(
  userId: number,
  profileId?: number | null,
): Pick<ClientContactPatchPayload, 'user' | 'owner'> {
  const uid = Math.trunc(userId);
  const body: Pick<ClientContactPatchPayload, 'user' | 'owner'> = { user: uid };
  const pid = profileId != null ? coerceUserPk(profileId) : null;
  if (pid != null && pid > 0 && pid !== uid) {
    body.owner = pid;
  }
  return body;
}
