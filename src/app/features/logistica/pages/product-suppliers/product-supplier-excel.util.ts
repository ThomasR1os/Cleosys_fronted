import * as XLSX from 'xlsx';
import type { ProductSupplierBulkItem } from '../../services/product-supplier.service';

export type ProductSupplierExcelIssue = {
  label: string;
  message: string;
};

export type PreparedProductSupplierBulkItem = {
  excelRow: number;
  item: ProductSupplierBulkItem;
};

const BULK_CHUNK_SIZE = 500;

export function productSupplierBulkChunkSize(): number {
  return BULK_CHUNK_SIZE;
}

type RawExcelRow = {
  excelRow: number;
  sku: string;
  supplierRuc: string;
  money: string;
  cost: string;
  incoterm: string;
  lead: string;
};

type ExcelParseResult =
  | { ok: true; rows: RawExcelRow[]; headerFields: Array<keyof Omit<RawExcelRow, 'excelRow'>> }
  | { ok: false; error: string };

const SLUG_TO_FIELD: Record<string, keyof Omit<RawExcelRow, 'excelRow'>> = {
  sku: 'sku',
  codigo: 'sku',
  codigo_sku: 'sku',
  ruc: 'supplierRuc',
  supplier_ruc: 'supplierRuc',
  ruc_proveedor: 'supplierRuc',
  money: 'money',
  moneda: 'money',
  cost: 'cost',
  costo: 'cost',
  incoterm: 'incoterm',
  estimated_lead_time_days: 'lead',
  plazo: 'lead',
  plazo_estimado: 'lead',
  tiempo_estimado: 'lead',
  lead_time: 'lead',
};

function slugHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function parseProductSupplierExcel(buffer: ArrayBuffer): ExcelParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo Excel.' };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'El libro no tiene hojas.' };
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  });
  if (!matrix.length) return { ok: false, error: 'La primera hoja está vacía.' };

  const headerRow = matrix[0] ?? [];
  const headerMap = new Map<number, keyof Omit<RawExcelRow, 'excelRow'>>();
  headerRow.forEach((cell, index) => {
    const field = SLUG_TO_FIELD[slugHeader(cellText(cell))];
    if (field) headerMap.set(index, field);
  });
  if (![...headerMap.values()].includes('sku')) {
    return { ok: false, error: 'Falta la columna SKU. Usa la cabecera "sku".' };
  }
  if (![...headerMap.values()].includes('supplierRuc')) {
    return { ok: false, error: 'Falta la columna de RUC. Usa la cabecera "ruc".' };
  }

  const rows: RawExcelRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const cells = matrix[index] ?? [];
    const partial: Omit<RawExcelRow, 'excelRow'> = {
      sku: '',
      supplierRuc: '',
      money: '',
      cost: '',
      incoterm: '',
      lead: '',
    };
    for (const [col, field] of headerMap) {
      partial[field] = cellText(cells[col]);
    }
    if (
      !partial.sku &&
      !partial.supplierRuc &&
      !partial.money &&
      !partial.cost &&
      !partial.incoterm &&
      !partial.lead
    ) {
      continue;
    }
    rows.push({ excelRow: index + 1, ...partial });
  }

  if (!rows.length) return { ok: false, error: 'No hay filas para importar.' };
  return { ok: true, rows, headerFields: [...headerMap.values()] };
}

function normalizeMoney(raw: string): 'USD' | 'PEN' | null {
  const value = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (value === 'USD' || value === 'DOLAR' || value === 'DOLARES' || value === 'DOLLAR' || value === 'DOLLARS') {
    return 'USD';
  }
  if (value === 'PEN' || value === 'SOL' || value === 'SOLES') return 'PEN';
  return null;
}

function normalizeCost(raw: string): string | null {
  const value = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  return value;
}

function normalizeIncoterm(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

/** Vacío es null. Un entero ≥ 0 son los días. Decimales como 45.0 se aceptan. */
function normalizeLeadDays(raw: string): number | null | undefined {
  const value = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!value) return null;
  if (!/^\d+(\.0+)?$/.test(value)) return undefined;
  const days = Math.trunc(Number(value));
  return Number.isFinite(days) && days >= 0 ? days : undefined;
}

function rowLabel(excelRow: number, sku: string, ruc: string): string {
  const parts = [`Fila ${excelRow}`];
  if (sku.trim()) parts.push(sku.trim());
  if (ruc.trim()) parts.push(`RUC ${ruc.trim()}`);
  return parts.join(' · ');
}

export function readProductSupplierExcel(buffer: ArrayBuffer):
  | { ok: false; error: string }
  | { ok: true; items: PreparedProductSupplierBulkItem[]; errors: ProductSupplierExcelIssue[] } {
  const parsed = parseProductSupplierExcel(buffer);
  if (!parsed.ok) return parsed;

  const errors: ProductSupplierExcelIssue[] = [];
  const valid: PreparedProductSupplierBulkItem[] = [];
  const hasLeadColumn = [...parsed.headerFields].includes('lead');

  for (const row of parsed.rows) {
    const sku = row.sku.trim();
    const supplierRuc = row.supplierRuc.replace(/\s/g, '');
    const label = rowLabel(row.excelRow, sku, supplierRuc);
    const money = normalizeMoney(row.money);
    const cost = normalizeCost(row.cost);
    const incoterm = normalizeIncoterm(row.incoterm);
    const lead = hasLeadColumn ? normalizeLeadDays(row.lead) : undefined;
    const problems: string[] = [];
    if (!sku) problems.push('falta el SKU');
    if (!supplierRuc) problems.push('falta el RUC');
    if (!money) problems.push('la moneda debe ser USD o PEN');
    if (!cost) problems.push('el costo debe ser un número mayor o igual a 0');
    if (!incoterm) problems.push('el incoterm debe ser 3 letras, por ejemplo EXW');
    if (lead === undefined && hasLeadColumn) {
      problems.push('el plazo estimado debe ser un número entero de días, o quedar vacío');
    }
    if (problems.length || !money || !cost || !incoterm) {
      errors.push({ label, message: problems.join('; ') });
      continue;
    }
    const item: ProductSupplierBulkItem = { sku, supplier_ruc: supplierRuc, money, cost, incoterm };
    if (hasLeadColumn) item.estimated_lead_time_days = lead ?? null;
    valid.push({ excelRow: row.excelRow, item });
  }

  const lastByPair = new Map<string, number>();
  valid.forEach((row, index) => {
    lastByPair.set(`${row.item.sku.toLowerCase()}|${row.item.supplier_ruc.toLowerCase()}`, index);
  });
  const items: PreparedProductSupplierBulkItem[] = [];
  valid.forEach((row, index) => {
    const key = `${row.item.sku.toLowerCase()}|${row.item.supplier_ruc.toLowerCase()}`;
    if (lastByPair.get(key) !== index) {
      errors.push({
        label: rowLabel(row.excelRow, row.item.sku, row.item.supplier_ruc),
        message: 'El mismo SKU y RUC se repite más abajo; se usa esa última fila.',
      });
      return;
    }
    items.push(row);
  });

  return { ok: true, items, errors };
}

export function downloadProductSupplierExcelTemplate(): void {
  const headers = ['sku', 'ruc', 'moneda', 'costo', 'incoterm', 'plazo_estimado'];
  const example = ['EJEMPLO-SKU', '20123456789', 'USD', '12.75', 'EXW', '45'];
  const sheet = XLSX.utils.aoa_to_sheet([headers, example]);
  sheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Relaciones');
  XLSX.writeFile(workbook, 'plantilla_producto_proveedor.xlsx');
}
