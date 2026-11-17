import * as XLSX from 'xlsx';
import type { MovementType, WarehouseMovementWrite } from '../../models/almacen.models';

/**
 * Plantilla / parseo para movimientos de almacén.
 *
 * Columnas obligatorias: sku, warehouse_id, owner_company_id, movement_type, cant
 * Opcionales: observation, creation_date
 *
 * Ejemplo unitario:
 * POST /api/almacen/warehouse-movements/
 * { warehouse: 1, product: 10, owner_company: 2, cant: "5.00",
 *   movement_type: "ENTRADA", observation: "Ingreso CDP en almacén Leo" }
 */
export const MOVEMENT_IMPORT_HEADERS = [
  'sku',
  'warehouse_id',
  'owner_company_id',
  'movement_type',
  'cant',
  'observation',
  'creation_date',
] as const;

export const MOVEMENT_IMPORT_MAX_ROWS = 5000;

/** Progreso visual: actualizar cada N filas para no saturar Angular. */
export const MOVEMENT_IMPORT_PROGRESS_EVERY = 5;

export type ParsedMovementExcelRow = {
  excelRow: number;
  sku: string;
  warehouse_id: number;
  owner_company_id: number;
  movement_type: MovementType;
  cant: string;
  observation?: string;
  creation_date?: string;
};

export type MovementExcelParseResult =
  | { ok: true; rows: ParsedMovementExcelRow[] }
  | { ok: false; error: string };

export function downloadMovementExcelTemplate(): void {
  const headers = [...MOVEMENT_IMPORT_HEADERS];
  const rows: (string | number)[][] = [
    headers,
    ['SKU-EJEMPLO-001', 1, 2, 'ENTRADA', '5.00', 'Ingreso CDP en almacén Leo', ''],
    ['SKU-EJEMPLO-001', 1, 2, 'SALIDA', 2, 'Entrega a cliente', '2026-03-15 14:30'],
    ['SKU-EJEMPLO-001', 1, 2, 'ENTRADA', 10, 'Ingreso de compra', '2026-03-15'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.writeFile(wb, 'plantilla_movimientos_almacen.xlsx');
}

function cellStr(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const hh = String(value.getHours()).padStart(2, '0');
    const mm = String(value.getMinutes()).padStart(2, '0');
    if (value.getHours() || value.getMinutes() || value.getSeconds()) {
      return `${y}-${m}-${d} ${hh}:${mm}`;
    }
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

function isBlankRow(row: unknown[] | undefined): boolean {
  if (!row || row.length === 0) return true;
  return row.every((cell) => cellStr(cell) === '');
}

function parseIntCell(raw: unknown, field: string, excelRow: number): number | { error: string } {
  const text = cellStr(raw).replace(/\.0$/, '');
  if (!text) return { error: `Fila ${excelRow}: ${field} es obligatorio.` };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) {
    return { error: `Fila ${excelRow}: ${field} debe ser un entero.` };
  }
  return n;
}

function parseCant(raw: unknown, excelRow: number): string | { error: string } {
  let text = cellStr(raw).replace(/\s/g, '');
  if (!text) return { error: `Fila ${excelRow}: cant es obligatorio.` };
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) {
    return { error: `Fila ${excelRow}: cant debe ser un número mayor que 0.` };
  }
  // Misma forma que el alta manual: decimal en texto.
  const fixed = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (!fixed.includes('.')) return `${fixed}.00`;
  const decimals = fixed.split('.')[1] ?? '';
  if (decimals.length < 2) return `${fixed}${'0'.repeat(2 - decimals.length)}`;
  return fixed;
}

function parseMovementType(raw: unknown, excelRow: number): MovementType | { error: string } {
  const text = cellStr(raw).toUpperCase();
  if (text === 'ENTRADA' || text === 'SALIDA') return text;
  return { error: `Fila ${excelRow}: movement_type debe ser ENTRADA o SALIDA.` };
}

/**
 * Lee el Excel en el navegador y valida columnas / tipos básicos.
 * La resolución SKU → product id y el POST quedan en el componente.
 */
export async function parseMovementExcelFile(file: File): Promise<MovementExcelParseResult> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo Excel.' };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch {
    return { ok: false, error: 'No se pudo leer el Excel. Use un archivo .xlsx.' };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'Archivo vacío.' };

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  if (!matrix.length) return { ok: false, error: 'Archivo vacío.' };

  const headerRow = (matrix[0] ?? []).map((cell) => cellStr(cell).toLowerCase());
  const col = (name: string): number => headerRow.indexOf(name);
  const required = ['sku', 'warehouse_id', 'owner_company_id', 'movement_type', 'cant'] as const;
  const missing = required.filter((name) => col(name) < 0);
  if (missing.length) {
    return { ok: false, error: `Faltan columnas: ${missing.join(', ')}.` };
  }

  const rows: ParsedMovementExcelRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const excelRow = i + 1;
    const line = matrix[i] as unknown[];
    if (isBlankRow(line)) continue;

    const sku = cellStr(line[col('sku')]);
    if (!sku) return { ok: false, error: `Fila ${excelRow}: sku es obligatorio.` };

    const warehouse = parseIntCell(line[col('warehouse_id')], 'warehouse_id', excelRow);
    if (typeof warehouse === 'object') return { ok: false, error: warehouse.error };

    const owner = parseIntCell(line[col('owner_company_id')], 'owner_company_id', excelRow);
    if (typeof owner === 'object') return { ok: false, error: owner.error };

    const movement_type = parseMovementType(line[col('movement_type')], excelRow);
    if (typeof movement_type === 'object') return { ok: false, error: movement_type.error };

    const cant = parseCant(line[col('cant')], excelRow);
    if (typeof cant === 'object') return { ok: false, error: cant.error };

    const observationIdx = col('observation');
    const observation =
      observationIdx >= 0 ? cellStr(line[observationIdx]) || undefined : undefined;
    if (observation && observation.length > 500) {
      return { ok: false, error: `Fila ${excelRow}: observation admite hasta 500 caracteres.` };
    }

    const creationIdx = col('creation_date');
    const creation_date =
      creationIdx >= 0 ? cellStr(line[creationIdx]) || undefined : undefined;

    rows.push({
      excelRow,
      sku,
      warehouse_id: warehouse,
      owner_company_id: owner,
      movement_type,
      cant,
      observation,
      creation_date,
    });
  }

  if (!rows.length) {
    return { ok: false, error: 'El archivo no tiene filas de movimientos.' };
  }
  if (rows.length > MOVEMENT_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `Máximo ${MOVEMENT_IMPORT_MAX_ROWS} filas por archivo (hay ${rows.length}).`,
    };
  }

  return { ok: true, rows };
}

export function movementRowToWrite(
  row: ParsedMovementExcelRow,
  productId: number,
): WarehouseMovementWrite {
  const body: WarehouseMovementWrite = {
    warehouse: row.warehouse_id,
    product: productId,
    owner_company: row.owner_company_id,
    cant: row.cant,
    movement_type: row.movement_type,
  };
  if (row.observation) body.observation = row.observation;
  if (row.creation_date) body.creation_date = row.creation_date;
  return body;
}
