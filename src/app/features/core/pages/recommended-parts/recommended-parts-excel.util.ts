import * as XLSX from 'xlsx';

/**
 * Plantilla Excel para POST /api/subcategory-recommended-parts/import-excel/
 * Headers: subcategory_id, name, description, sort_order, is_active
 */
export function downloadRecommendedPartsExcelTemplate(): void {
  const headers = [
    'subcategory_id',
    'name',
    'description',
    'sort_order',
    'is_active',
  ] as const;
  const example = [3, 'Sello eje', 'Sello del eje principal', 1, 'si'];
  const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[], example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Partes');
  XLSX.writeFile(wb, 'plantilla_partes_recomendadas.xlsx');
}
