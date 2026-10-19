import type { ProformaRequestRow } from '../models/ventas.models';

const DROP_KEYS = new Set([
  'request_items',
  'clarifications',
  'supplier_offers',
  'company_client_detail',
]);

export interface ParsedProformaList {
  rows: ProformaRequestRow[];
  next: string | null;
}

function asUserDetail(value: unknown): ProformaRequestRow['assigned_user_detail'] {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row['id']);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    username: String(row['username'] ?? ''),
    first_name: String(row['first_name'] ?? ''),
    last_name: String(row['last_name'] ?? ''),
    nombre: String(row['nombre'] ?? ''),
  };
}

function asClientDetail(value: unknown): ProformaRequestRow['client_detail'] {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = Number(row['id']);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    ruc: String(row['ruc'] ?? ''),
    name: String(row['name'] ?? ''),
  };
}

function asText(value: unknown, max = 400): string {
  if (value == null) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function slimListRow(raw: unknown): ProformaRequestRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = Number(row['id']);
  if (!Number.isFinite(id) || id <= 0) return null;
  const assigned = Number(row['assigned_user']);
  return {
    id,
    company: Number(row['company'] ?? 0),
    client: Number(row['client'] ?? 0),
    client_detail: asClientDetail(row['client_detail']),
    assigned_user: Number.isFinite(assigned) ? assigned : 0,
    assigned_user_detail: asUserDetail(row['assigned_user_detail']),
    sales_owner: Number(row['sales_owner']) || null,
    sales_owner_detail: asUserDetail(row['sales_owner_detail']),
    logistics_owner: Number(row['logistics_owner']) || null,
    logistics_owner_detail: asUserDetail(row['logistics_owner_detail']),
    created_by_detail: asUserDetail(row['created_by_detail']),
    entry_channel: (row['entry_channel'] as ProformaRequestRow['entry_channel']) ?? 'WHATSAPP',
    proforma_type: (row['proforma_type'] as ProformaRequestRow['proforma_type']) ?? 'MAQUINARIA',
    status: (row['status'] as ProformaRequestRow['status']) ?? 'PENDIENTE',
    workflow_status: (row['workflow_status'] as ProformaRequestRow['workflow_status']) ?? null,
    priority: (row['priority'] as ProformaRequestRow['priority']) ?? 'NORMAL',
    due_at: row['due_at'] == null ? null : String(row['due_at']),
    task_queue: (row['task_queue'] as ProformaRequestRow['task_queue']) ?? null,
    waiting_on: (row['waiting_on'] as ProformaRequestRow['waiting_on']) ?? null,
    correlativo: row['correlativo'] == null ? null : String(row['correlativo']),
    task_id: Number(row['task_id']) || null,
    task_correlativo: row['task_correlativo'] == null ? null : String(row['task_correlativo']),
    description: asText(row['description'], 400),
    quotation: row['quotation'] == null ? null : Number(row['quotation']),
    quotation_correlativo: row['quotation_correlativo'] == null ? null : String(row['quotation_correlativo']),
    entered_at: row['entered_at'] == null ? null : String(row['entered_at']),
    quoted_at: row['quoted_at'] == null ? null : String(row['quoted_at']),
    updated_at: row['updated_at'] == null ? null : String(row['updated_at']),
    last_moved_at: row['last_moved_at'] == null ? null : String(row['last_moved_at']),
    logistics_order_id: Number(row['logistics_order_id']) || null,
  };
}

function parseProformaListText(text: string): ParsedProformaList {
  const data = JSON.parse(text, (key, value) => (DROP_KEYS.has(key) ? undefined : value)) as unknown;
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((data as { results?: unknown[] }).results ?? [])
      : [];
  const rows: ProformaRequestRow[] = [];
  for (const item of raw) {
    const slim = slimListRow(item);
    if (slim) rows.push(slim);
  }
  const next =
    data && typeof data === 'object' && typeof (data as { next?: unknown }).next === 'string'
      ? String((data as { next: string }).next)
      : null;
  return { rows, next };
}

/** Cede el hilo para que el spinner pinte antes de JSON.parse. */
export function parseProformaListTextAsync(text: string): Promise<ParsedProformaList> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(parseProformaListText(text));
      } catch (err) {
        reject(err);
      }
    }, 0);
  });
}
