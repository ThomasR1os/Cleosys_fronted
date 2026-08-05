import * as XLSX from 'xlsx';
import type { Product } from '../../../almacen/models/almacen.models';

/** Campos importables (sin imágenes). */
export type ProductExcelRow = {
  sku: string;
} & Partial<{
  description: string | null;
  category: number | null;
  subcategory: number | null;
  type: number | null;
  brand: number | null;
  unit_measurement: number | null;
  datasheet: string | null;
  price: number | null;
  rental_price_without_operator: number | null;
  rental_price_with_operator: number | null;
  warranty: string | null;
  status: string | null;
  dimensions: string | null;
  gross_weight: string | null;
}>;

export type ExcelParseResult =
  | { ok: true; rows: ProductExcelRow[] }
  | { ok: false; error: string };

const FK_FIELDS = new Set([
  'category',
  'subcategory',
  'type',
  'brand',
  'unit_measurement',
]);

function slugHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

/** Cabeceras Excel (normalizadas) → campo API. */
const SLUG_TO_FIELD: Record<string, keyof ProductExcelRow> = {
  sku: 'sku',
  codigo: 'sku',
  codigo_sku: 'sku',
  descripcion: 'description',
  description: 'description',
  categoria: 'category',
  category: 'category',
  subcategoria: 'subcategory',
  subcategory: 'subcategory',
  tipo: 'type',
  type: 'type',
  marca: 'brand',
  brand: 'brand',
  unidad: 'unit_measurement',
  unidad_de_medida: 'unit_measurement',
  unit_measurement: 'unit_measurement',
  datasheet: 'datasheet',
  precio: 'price',
  price: 'price',
  rental_price_without_operator: 'rental_price_without_operator',
  precio_alquiler_sin_operador: 'rental_price_without_operator',
  rental_price_with_operator: 'rental_price_with_operator',
  precio_alquiler_con_operador: 'rental_price_with_operator',
  warrannty: 'warranty',
  warranty: 'warranty',
  garantia: 'warranty',
  status: 'status',
  estado: 'status',
  dimensions: 'dimensions',
  dimensiones: 'dimensions',
  gross_weight: 'gross_weight',
  peso_bruto: 'gross_weight',
};

function parseCell(field: keyof ProductExcelRow, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') return undefined;
  if (FK_FIELDS.has(field as string)) {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
    if (Number.isNaN(n)) return undefined;
    return n;
  }
  if (field === 'price' || field === 'rental_price_without_operator' || field === 'rental_price_with_operator') {
    const n = decimalOrNull(raw);
    return n === null ? undefined : n;
  }
  const s = String(raw).trim();
  return s === '' ? undefined : s;
}

export function parseProductExcel(buffer: ArrayBuffer): ExcelParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo Excel.' };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'El libro no tiene hojas.' };
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  if (!json.length) return { ok: false, error: 'La primera hoja está vacía.' };

  const sample = json[0];
  const headerMap = new Map<string, keyof ProductExcelRow>();
  for (const key of Object.keys(sample)) {
    const slug = slugHeader(key);
    const field = SLUG_TO_FIELD[slug];
    if (field) headerMap.set(key, field);
  }
  const hasSku = [...headerMap.values()].includes('sku');
  if (!hasSku) {
    return {
      ok: false,
      error: 'Falta la columna SKU (obligatoria). Usa la cabecera "sku" o "codigo".',
    };
  }

  const rows: ProductExcelRow[] = [];
  for (const raw of json) {
    const partial: Record<string, unknown> = {};
    for (const [excelKey, field] of headerMap) {
      const v = parseCell(field, raw[excelKey]);
      if (v !== undefined) partial[field as string] = v;
    }
    const sku = partial['sku'];
    if (typeof sku !== 'string' || !sku.trim()) continue;
    rows.push(partial as ProductExcelRow);
  }

  if (!rows.length) return { ok: false, error: 'No hay ninguna fila con SKU válido.' };
  return { ok: true, rows };
}

function decimalOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normalizeBulkStatus(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const upper = s.toUpperCase();
  if (upper === 'ACTIVE' || upper === 'ACTIVO') return 'ACTIVE';
  if (upper === 'INACTIVE' || upper === 'INACTIVO') return 'INACTIVE';
  return upper;
}

/**
 * Item para POST bulk-upsert con partial_update: solo sku + campos presentes en la fila.
 * No envía null en CharField sin allow_null (p. ej. description) — eso hace fallar todo el lote en DRF.
 */
export function excelRowToBulkItem(partial: ProductExcelRow): Record<string, unknown> {
  const sku = partial.sku.trim();
  if (!sku) throw new Error('SKU vacío');

  const item: Record<string, unknown> = { sku };

  if (partial.description !== undefined) {
    const d = strOrNull(partial.description);
    if (d != null) item['description'] = d.slice(0, 250);
  }
  if (partial.datasheet !== undefined) {
    const d = strOrNull(partial.datasheet);
    if (d != null) item['datasheet'] = d;
  }
  if (partial.warranty !== undefined) {
    const w = strOrNull(partial.warranty);
    if (w != null) item['warranty'] = w.slice(0, 20);
  }
  if (partial.status !== undefined) {
    const st = normalizeBulkStatus(String(partial.status));
    if (st === 'ACTIVE' || st === 'INACTIVE') item['status'] = st;
  }
  if (partial.dimensions !== undefined) {
    const d = strOrNull(partial.dimensions);
    if (d != null) item['dimensions'] = d.slice(0, 100);
  }
  if (partial.gross_weight !== undefined) {
    const g = strOrNull(partial.gross_weight);
    if (g != null) item['gross_weight'] = g.slice(0, 100);
  }

  const fkFields = [
    'category',
    'subcategory',
    'type',
    'brand',
    'unit_measurement',
  ] as const;
  for (const key of fkFields) {
    const v = partial[key];
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
      item[key] = Number(v);
    }
  }

  const moneyFields = [
    'price',
    'rental_price_without_operator',
    'rental_price_with_operator',
  ] as const;
  for (const key of moneyFields) {
    const v = partial[key];
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
      // string evita problemas de float con DecimalField de DRF
      item[key] = Number(v).toFixed(2);
    }
  }

  return item;
}

/**
 * Construye el cuerpo para POST/PATCH. Si `existing` existe, solo sobrescribe campos
 * presentes en la fila Excel (`partial`); el resto se mantiene del producto actual.
 */
export function excelRowToProductPayload(
  partial: ProductExcelRow,
  existing: Product | null,
): Partial<Product> {
  const sku = partial.sku.trim();
  if (!sku) throw new Error('SKU vacío');

  if (!existing) {
    const desc = strOrNull(partial.description) ?? '(sin descripción)';
    return {
      sku,
      description: desc,
      category: partial.category ?? null,
      subcategory: partial.subcategory ?? null,
      type: partial.type ?? null,
      brand: partial.brand ?? null,
      unit_measurement: partial.unit_measurement ?? null,
      datasheet: strOrNull(partial.datasheet),
      price: partial.price ?? null,
      rental_price_without_operator: partial.rental_price_without_operator ?? null,
      rental_price_with_operator: partial.rental_price_with_operator ?? null,
      warranty: strOrNull(partial.warranty),
      status: strOrNull(partial.status) ?? 'ACTIVE',
      dimensions: strOrNull(partial.dimensions),
      gross_weight: strOrNull(partial.gross_weight),
    };
  }

  const o: Partial<Product> = {
    sku: existing.sku,
    description:
      partial.description !== undefined ? strOrNull(partial.description) ?? '' : existing.description,
    category: partial.category !== undefined ? partial.category : existing.category,
    subcategory: partial.subcategory !== undefined ? partial.subcategory : existing.subcategory,
    type: partial.type !== undefined ? partial.type : existing.type,
    brand: partial.brand !== undefined ? partial.brand : existing.brand,
    unit_measurement:
      partial.unit_measurement !== undefined ? partial.unit_measurement : existing.unit_measurement,
    datasheet:
      partial.datasheet !== undefined ? strOrNull(partial.datasheet) : existing.datasheet,
    price: partial.price !== undefined ? partial.price : existing.price,
    rental_price_without_operator:
      partial.rental_price_without_operator !== undefined
        ? partial.rental_price_without_operator
        : existing.rental_price_without_operator,
    rental_price_with_operator:
      partial.rental_price_with_operator !== undefined
        ? partial.rental_price_with_operator
        : existing.rental_price_with_operator,
    warranty:
      partial.warranty !== undefined ? strOrNull(partial.warranty) : existing.warranty,
    status: partial.status !== undefined ? strOrNull(partial.status) ?? 'ACTIVE' : existing.status,
    dimensions:
      partial.dimensions !== undefined ? strOrNull(partial.dimensions) : existing.dimensions,
    gross_weight:
      partial.gross_weight !== undefined ? strOrNull(partial.gross_weight) : existing.gross_weight,
  };
  return o;
}

export function downloadProductExcelTemplate(): void {
  const headers = [
    'sku',
    'description',
    'category',
    'subcategory',
    'type',
    'brand',
    'unit_measurement',
    'datasheet',
    'price',
    'rental_price_without_operator',
    'rental_price_with_operator',
    'warranty',
    'status',
    'dimensions',
    'gross_weight',
  ] as const;
  const example = [
    'EJ-SKU-001',
    'Producto ejemplo',
    1,
    1,
    1,
    1,
    1,
    'Texto o especificaciones',
    '99.90',
    '',
    '',
    '12 meses',
    'ACTIVE',
    '10x20x30 cm',
    '2.5 kg',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[], example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  XLSX.writeFile(wb, 'plantilla_productos.xlsx');
}
