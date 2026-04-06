import type { CompanyBranding } from '../models/admin-users.models';

/** Valores por defecto alineados con `accounts/branding_defaults.py` (Django). */
export const DEFAULT_COMPANY_BRANDING: CompanyBranding = {
  primary: '#1E3A5F',
  primary_light: '#F1F5F9',
  muted: '#64748B',
  border: '#E2E8F0',
  table_stripe: '#F8FAFC',
  emphasis_bar: '#0F172A',
  text_body: '#3C3C3C',
  text_label: '#374151',
  text_caption: '#475569',
};

export type PdfQuotationTheme = {
  primary: [number, number, number];
  primaryLight: [number, number, number];
  muted: [number, number, number];
  border: [number, number, number];
  stripe: [number, number, number];
  totalBar: [number, number, number];
  textBody: [number, number, number];
  textLabel: [number, number, number];
  textCaption: [number, number, number];
  white: number;
  pdfDescExtraPadding: number;
};

const FALLBACK_PRIMARY: [number, number, number] = [30, 58, 95];

/** `#RRGGBB` o `RRGGBB` → RGB para jsPDF. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [...FALLBACK_PRIMARY] as [number, number, number];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function brandingToPdfTheme(b: CompanyBranding): PdfQuotationTheme {
  return {
    primary: hexToRgb(b.primary),
    primaryLight: hexToRgb(b.primary_light),
    muted: hexToRgb(b.muted),
    border: hexToRgb(b.border),
    stripe: hexToRgb(b.table_stripe),
    totalBar: hexToRgb(b.emphasis_bar),
    textBody: hexToRgb(b.text_body),
    textLabel: hexToRgb(b.text_label),
    textCaption: hexToRgb(b.text_caption),
    white: 255,
    pdfDescExtraPadding: 2,
  };
}

export const DEFAULT_PDF_QUOTATION_THEME = brandingToPdfTheme(DEFAULT_COMPANY_BRANDING);

/** Etiquetas UI para edición de branding (orden de formulario). */
export const COMPANY_BRANDING_FIELD_META: {
  key: keyof Omit<CompanyBranding, 'extensions'>;
  label: string;
  hint: string;
}[] = [
  { key: 'primary', label: 'Color principal', hint: 'Títulos, cabecera de tabla, acentos' },
  { key: 'primary_light', label: 'Fondo suave', hint: 'Bloques de resumen / totales' },
  { key: 'muted', label: 'Texto secundario', hint: 'Etiquetas (RUC, meta líneas)' },
  { key: 'border', label: 'Bordes', hint: 'Líneas y contornos de tabla' },
  { key: 'table_stripe', label: 'Rayado de filas', hint: 'Filas impares en productos' },
  { key: 'emphasis_bar', label: 'Barra destacada', hint: 'Totales y texto de énfasis' },
  { key: 'text_body', label: 'Cuerpo', hint: 'Párrafos (cuentas, condiciones)' },
  { key: 'text_label', label: 'Etiqueta ficha', hint: 'Título «Ficha técnica»' },
  { key: 'text_caption', label: 'Texto ficha', hint: 'Cuerpo de ficha técnica' },
];
