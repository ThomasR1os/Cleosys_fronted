import { Pipe, PipeTransform } from '@angular/core';

/**
 * Fecha compacta sin hora (p. ej. listados), en español Perú.
 */
@Pipe({
  name: 'shortDateTime',
  standalone: true,
})
export class ShortDateTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (value == null || value === '') return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
