/**
 * Convierte valores del API o del formulario (id, pk, objeto User anidado) al id numérico
 * que esperan los serializers de Django en campos FK `user` / `assigned_user`.
 */
export function coerceUserPk(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  if (typeof value !== 'object') return null;

  const o = value as Record<string, unknown>;

  // Objeto User expandido del API (tiene username, first_name, etc.)
  const looksLikeUser =
    typeof o['username'] === 'string' ||
    typeof o['first_name'] === 'string' ||
    typeof o['is_superuser'] === 'boolean';

  if (looksLikeUser) {
    const direct = coerceUserPk(o['id'] ?? o['pk']);
    if (direct != null) return direct;
  }

  if (typeof o['user'] !== 'undefined') {
    const nested = coerceUserPk(o['user']);
    if (nested != null) return nested;
  }

  if (typeof o['id'] === 'number' && o['id'] > 0) return Math.trunc(o['id']);
  if (typeof o['id'] === 'string') {
    const fromId = coerceUserPk(o['id']);
    if (fromId != null) return fromId;
  }
  if (typeof o['id'] === 'object' && o['id'] !== null) {
    const nestedId = coerceUserPk(o['id']);
    if (nestedId != null) return nestedId;
  }
  if (typeof o['pk'] === 'number' && o['pk'] > 0) return Math.trunc(o['pk']);
  if (typeof o['pk'] === 'string') return coerceUserPk(o['pk']);

  return null;
}
