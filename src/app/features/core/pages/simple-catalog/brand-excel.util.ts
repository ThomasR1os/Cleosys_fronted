import * as XLSX from 'xlsx';

export type BrandExcelRow = {
  /** Fila Excel 1-based (incluye cabecera → datos desde 2). */
  excelRow: number;
  id?: number;
  name: string;
};

export type BrandExcelIssue = {
  label: string;
  message: string;
};

export type BrandExcelParseResult =
  | { ok: true; rows: BrandExcelRow[]; issues: BrandExcelIssue[] }
  | { ok: false; error: string };

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

function parseOptionalId(raw: unknown): number | undefined | 'invalid' {
  if (raw == null) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0 || n !== Math.trunc(n)) return 'invalid';
  return n;
}

/**
 * Plantilla para alta masiva de marcas.
 * Columnas: id (opcional), name / nombre (obligatorio).
 */
export function downloadBrandsExcelTemplate(): void {
  const headers = ['id', 'nombre'];
  const example = ['', 'Marca ejemplo'];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = [{ wch: 10 }, { wch: 32 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marcas');
  XLSX.writeFile(wb, 'plantilla_marcas.xlsx');
}

/** Descarga el listado actual (ID + nombre). */
export function downloadBrandsExcel(
  rows: Array<{ id: number | string; name: string }>,
): void {
  const data = [
    ['id', 'nombre'],
    ...rows.map((r) => [r.id, r.name]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 10 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marcas');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `marcas_${stamp}.xlsx`);
}

export function parseBrandsExcel(buffer: ArrayBuffer): BrandExcelParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo Excel.' };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'El libro no tiene hojas.' };
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  if (!matrix.length) return { ok: false, error: 'La primera hoja está vacía.' };

  const headerRow = matrix[0] ?? [];
  let idCol = -1;
  let nameCol = -1;
  headerRow.forEach((cell, index) => {
    const slug = slugHeader(cellText(cell));
    if (slug === 'id' || slug === 'codigo') idCol = index;
    if (slug === 'name' || slug === 'nombre' || slug === 'marca') nameCol = index;
  });
  if (nameCol < 0) {
    return {
      ok: false,
      error: 'Falta la columna de nombre. Usa la cabecera "nombre" o "name".',
    };
  }

  const rows: BrandExcelRow[] = [];
  const issues: BrandExcelIssue[] = [];
  const seenNames = new Map<string, number>();
  const seenIds = new Map<number, number>();

  for (let i = 1; i < matrix.length; i++) {
    const excelRow = i + 1;
    const cells = matrix[i] ?? [];
    const name = cellText(cells[nameCol]);
    if (!name) {
      const anyFilled = cells.some((c) => cellText(c) !== '');
      if (anyFilled) {
        issues.push({ label: `Fila ${excelRow}`, message: 'Falta el nombre.' });
      }
      continue;
    }

    let id: number | undefined;
    if (idCol >= 0) {
      const parsedId = parseOptionalId(cells[idCol]);
      if (parsedId === 'invalid') {
        issues.push({
          label: `Fila ${excelRow} · ${name}`,
          message: 'El ID debe ser un entero positivo, o quedar vacío.',
        });
        continue;
      }
      id = parsedId;
    }

    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      issues.push({
        label: `Fila ${excelRow} · ${name}`,
        message: `Nombre duplicado en el Excel (también en fila ${seenNames.get(nameKey)}). Se usa la última.`,
      });
      const prevIdx = rows.findIndex((r) => r.name.toLowerCase() === nameKey);
      if (prevIdx >= 0) {
        const prev = rows[prevIdx];
        if (prev.id != null) seenIds.delete(prev.id);
        rows.splice(prevIdx, 1);
      }
    }
    seenNames.set(nameKey, excelRow);

    if (id != null) {
      if (seenIds.has(id)) {
        issues.push({
          label: `Fila ${excelRow} · ${name}`,
          message: `ID ${id} duplicado en el Excel (también en fila ${seenIds.get(id)}). Se usa la última.`,
        });
        const prevIdx = rows.findIndex((r) => r.id === id);
        if (prevIdx >= 0) {
          const prev = rows[prevIdx];
          seenNames.delete(prev.name.toLowerCase());
          rows.splice(prevIdx, 1);
        }
      }
      seenIds.set(id, excelRow);
    }

    rows.push(id != null ? { excelRow, id, name } : { excelRow, name });
  }

  if (!rows.length) {
    return { ok: false, error: 'No hay ninguna fila con nombre válido.' };
  }
  return { ok: true, rows, issues };
}
