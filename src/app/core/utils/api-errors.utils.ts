import { HttpErrorResponse } from '@angular/common/http';

/** Claves DRF que se muestran sin prefijo de campo. */
const BARE_KEYS = new Set(['detail', 'non_field_errors']);

/** Etiquetas UI para campos frecuentes de Servicios / Core. */
const FIELD_LABELS: Record<string, string> = {
  serial_number: 'Número de serie',
  hour_meter: 'Horómetro',
  current_hour_meter: 'Horómetro actual',
  part_checks: 'Checklist de partes',
  part_number: 'Número de parte',
  electrical_evaluation: 'Evaluación eléctrica',
  origin_report: 'Evaluación de origen',
  intervention_date: 'Fecha de intervención',
  current_condition: 'Condición actual',
  work_performed: 'Trabajos / inspecciones',
  background: 'Antecedentes',
  conclusions: 'Conclusiones',
  recommendations: 'Recomendaciones',
  photos: 'Fotos',
  photo_url: 'URL de foto',
  label: 'Etiqueta de foto',
  client: 'Cliente',
  brand: 'Marca',
  category: 'Categoría',
  subcategory: 'Subcategoría',
  model: 'Modelo',
  location: 'Ubicación',
  status: 'Estado',
  daily_working_hours: 'Horas diarias',
  starter_type: 'Tipo de arrancador',
  starter_brand: 'Marca de arrancador',
  nominal_voltage: 'Voltaje nominal',
  actual_voltage: 'Voltaje real',
  main_motor_current: 'Corriente motor principal',
  fan_motor_current: 'Corriente ventilador',
  control_voltage: 'Tensión de control',
  grounding: 'Puesta a tierra',
  name: 'Nombre',
  description: 'Descripción',
  file: 'Archivo',
  report_id: 'Informe',
};

/**
 * Aplana errores DRF (400) anidados a mensajes legibles.
 * Ej.: `{ serial_number: ["…"] }` → `["Número de serie: …"]`
 */
export function flattenApiErrors(data: unknown): string[] {
  const out: string[] = [];

  const walk = (v: unknown, prefix = ''): void => {
    if (v == null) return;
    if (typeof v === 'string') {
      const text = v.trim();
      if (!text) return;
      if (!prefix || BARE_KEYS.has(prefix)) {
        out.push(text);
      } else {
        out.push(`${humanizePrefix(prefix)}: ${text}`);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, prefix);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (/^\d+$/.test(k)) {
          walk(val, prefix);
          continue;
        }
        const next = prefix ? `${prefix}.${k}` : k;
        walk(val, next);
      }
    }
  };

  walk(data);
  return out;
}

function humanizePrefix(prefix: string): string {
  return prefix
    .split('.')
    .filter((p) => p && !/^\d+$/.test(p) && !BARE_KEYS.has(p))
    .map((p) => FIELD_LABELS[p] ?? p)
    .join(' → ');
}

function statusFallback(status: number): string | null {
  switch (status) {
    case 400:
      return 'Datos inválidos. Revisa el formulario.';
    case 401:
      return 'Sesión expirada o no autenticado. Vuelve a iniciar sesión.';
    case 403:
      return 'No tienes permiso para esta acción (o el recurso no pertenece a tu empresa).';
    case 404:
      return 'Recurso no encontrado.';
    case 502:
    case 503:
      return 'Error de servicio externo (p. ej. Cloudinary). Intenta de nuevo.';
    default:
      return null;
  }
}

/** Mensaje único para mostrar en alertas de UI. */
export function formatHttpError(err: unknown, fallback = 'Error desconocido'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (typeof body === 'string' && body.trim()) {
      const text = stripHtmlNoise(body);
      if (text) return text;
    }
    if (body && typeof body === 'object') {
      const lines = flattenApiErrors(body);
      if (lines.length) return lines.join('\n');
    }
    return statusFallback(err.status) || err.message || `Error ${err.status}` || fallback;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

function stripHtmlNoise(raw: string): string {
  const t = raw.trim();
  if (!t.includes('<')) return t;
  return t
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
