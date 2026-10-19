import * as XLSX from 'xlsx';

/** Plantilla para POST /api/almacen/warehouse-movements/import-excel/ */
export function downloadMovementExcelTemplate(): void {
  const headers = [
    'sku',
    'warehouse_id',
    'movement_type',
    'cant',
    'observation',
    'creation_date',
  ] as const;
  const rows: (string | number)[][] = [
    [...headers],
    ['SKU-EJEMPLO-001', 1, 'ENTRADA', 10, 'Ingreso de compra', '2026-03-15'],
    ['SKU-EJEMPLO-001', 1, 'SALIDA', 2, 'Entrega a cliente', '2026-03-15 14:30'],
    ['SKU-EJEMPLO-001', 1, 'ENTRADA', 5, '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.writeFile(wb, 'plantilla_movimientos_almacen.xlsx');
}
