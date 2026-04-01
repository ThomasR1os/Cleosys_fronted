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
  warrannty: string | null;
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
  warrannty: 'warrannty',
  warranty: 'warrannty',
  garantia: 'warrannty',
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
    return decimalOrNull(raw);
  }
  return String(raw).trim();
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
      warrannty: strOrNull(partial.warrannty),
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
    warrannty:
      partial.warrannty !== undefined ? strOrNull(partial.warrannty) : existing.warrannty,
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
    'warrannty',
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
