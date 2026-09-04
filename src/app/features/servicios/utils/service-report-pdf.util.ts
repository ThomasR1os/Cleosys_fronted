import { jsPDF } from 'jspdf';
import type { CompanyBranding } from '../../admin/models/admin-users.models';
import {
  brandingToPdfTheme,
  DEFAULT_COMPANY_BRANDING,
  type PdfQuotationTheme,
} from '../../admin/utils/company-branding.utils';
import { imageUrlToDataUrl } from '../../core/pages/productos/product-ficha-pdf.util';
import type {
  ElectricalEvaluation,
  Machine,
  ReportPhoto,
  ServiceReport,
} from '../models/servicios.models';

export type ReportPdfClient = {
  name: string;
  ruc?: string | null;
  address?: string | null;
};

export type ReportPdfCompany = {
  name: string;
  logoDataUrl: string | null;
  branding?: CompanyBranding | null;
};

type PhotoReady = {
  dataUrl: string;
  note: string;
  label: string;
};

type SpecRow = { label: string; value: string };

/** Fila de la tabla eléctrica: opciones con casilla, fases o texto libre. */
type ElectricalRow =
  | { kind: 'options'; label: string; options: { text: string; checked: boolean }[] }
  | { kind: 'phases'; label: string; cells: { prefix: string; value: string }[] }
  | { kind: 'text'; label: string; value: string };

const MARGIN = 14;
const GAP = 4;
const PAGE_TOP = 20;
const PAGE_BOTTOM = 18;
const PHOTO_HEIGHT = 52;
const ROW_H = 7;

function fmtNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '';
  return String(v);
}

function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    ACTIVE: 'Activa',
    OUT_OF_SERVICE: 'Fuera de servicio',
    DECOMMISSIONED: 'Dada de baja',
  };
  return (status && map[status]) || status || '—';
}

function conditionLabel(v: string | null | undefined): string {
  if (v === 'OPERATIONAL') return 'Operativo';
  if (v === 'INOPERATIVE') return 'Inoperativo';
  return v || '—';
}

function partCondLabel(v: string | null | undefined): string {
  const map: Record<string, string> = {
    OK: 'OK',
    REPLACE: 'Reemplazar',
    CLEAN: 'Limpiar',
  };
  return (v && map[v]) || v || '—';
}

function imageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg') ? 'JPEG' : 'PNG';
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - PAGE_BOTTOM) {
    doc.addPage();
    return PAGE_TOP;
  }
  return y;
}

/** Banda de sección numerada (color corporativo). */
function drawSectionBanner(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  title: string,
  pageW: number,
  minFollowing = 12,
): number {
  y = ensureSpace(doc, y, 11 + minFollowing);
  const contentW = pageW - MARGIN * 2;
  doc.setFillColor(...T.primary);
  doc.rect(MARGIN, y, contentW, 7.5, 'F');
  doc.setTextColor(T.white, T.white, T.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(title.toUpperCase(), MARGIN + 3, y + 5.2);
  doc.setTextColor(...T.textBody);
  return y + 10.5;
}

/** Encabezado interno de bloque (dentro de una sección). */
function drawSubheading(doc: jsPDF, T: PdfQuotationTheme, y: number, text: string): number {
  y = ensureSpace(doc, y, 9);
  doc.setDrawColor(...T.primary);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 4.6, MARGIN + 3, y + 4.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...T.primary);
  doc.text(text.toUpperCase(), MARGIN + 4.5, y + 4);
  doc.setLineWidth(0.2);
  return y + 7.5;
}

/** Tabla técnica etiqueta/valor en 2 columnas contiguas. */
function drawSpecTable(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  rows: SpecRow[],
  pageW: number,
): number {
  const contentW = pageW - MARGIN * 2;
  const colW = contentW / 2;
  const labelW = 34;
  const valueW = colW - labelW;

  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2);
    const measured = pair.map((row) => ({
      labelLines: doc.splitTextToSize(row.label, labelW - 3) as string[],
      valueLines: doc.splitTextToSize(row.value || '—', valueW - 3) as string[],
    }));
    const rowH = Math.max(
      ROW_H,
      ...measured.map((m) => Math.max(m.labelLines.length, m.valueLines.length) * 3.6 + 3),
    );
    y = ensureSpace(doc, y, rowH);

    doc.setFontSize(8);
    doc.setDrawColor(...T.border);
    for (let col = 0; col < 2; col++) {
      const x = MARGIN + col * colW;
      const data = measured[col];
      doc.setFillColor(...T.primaryLight);
      doc.rect(x, y, labelW, rowH, 'FD');
      doc.setFillColor(T.white, T.white, T.white);
      doc.rect(x + labelW, y, valueW, rowH, 'FD');
      if (!data) continue;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...T.textLabel);
      doc.text(data.labelLines, x + 2, y + 4.6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...T.textBody);
      doc.text(data.valueLines, x + labelW + 2, y + 4.6);
    }
    y += rowH;
  }
  return y + 4;
}

/** Casilla de verificación tipo formato técnico. */
function drawCheckbox(doc: jsPDF, T: PdfQuotationTheme, x: number, y: number, checked: boolean): void {
  const size = 3.4;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.25);
  if (checked) {
    doc.setFillColor(...T.primary);
    doc.rect(x, y, size, size, 'FD');
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.55);
    doc.line(x + 0.7, y + 1.8, x + 1.4, y + 2.6);
    doc.line(x + 1.4, y + 2.6, x + 2.7, y + 0.8);
  } else {
    doc.setFillColor(T.white, T.white, T.white);
    doc.rect(x, y, size, size, 'FD');
  }
  doc.setLineWidth(0.2);
}

/** Tabla de evaluación eléctrica con casillas y celdas por fase. */
function drawElectricalTable(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  rows: ElectricalRow[],
  pageW: number,
): number {
  const contentW = pageW - MARGIN * 2;
  const labelW = 58;
  const restW = contentW - labelW;

  y = ensureSpace(doc, y, 7.5 + ROW_H * 2);
  doc.setFillColor(...T.primary);
  doc.rect(MARGIN, y, contentW, 7, 'F');
  doc.setTextColor(T.white, T.white, T.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('EVALUACIÓN ELÉCTRICA', MARGIN + contentW / 2, y + 4.8, { align: 'center' });
  y += 7;

  for (const row of rows) {
    y = ensureSpace(doc, y, ROW_H);
    doc.setDrawColor(...T.border);
    doc.setFillColor(...T.primaryLight);
    doc.rect(MARGIN, y, labelW, ROW_H, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...T.textLabel);
    doc.text(row.label.toUpperCase(), MARGIN + 2.5, y + 4.7);

    const restX = MARGIN + labelW;
    doc.setFillColor(T.white, T.white, T.white);

    if (row.kind === 'options') {
      const cellW = restW / row.options.length;
      row.options.forEach((opt, i) => {
        const x = restX + i * cellW;
        doc.setDrawColor(...T.border);
        doc.rect(x, y, cellW, ROW_H, 'FD');
        drawCheckbox(doc, T, x + 3, y + 1.8, opt.checked);
        doc.setFont('helvetica', opt.checked ? 'bold' : 'normal');
        doc.setFontSize(7.5);
        const tone: [number, number, number] = opt.checked ? T.primary : T.textBody;
        doc.setTextColor(...tone);
        doc.text(opt.text, x + 9, y + 4.6);
      });
    } else if (row.kind === 'phases') {
      const cellW = restW / row.cells.length;
      row.cells.forEach((cell, i) => {
        const x = restX + i * cellW;
        doc.setDrawColor(...T.border);
        doc.rect(x, y, cellW, ROW_H, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...T.textCaption);
        doc.text(`${cell.prefix}:`, x + 2.5, y + 4.6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...T.textBody);
        doc.text(cell.value || '—', x + 16, y + 4.6);
      });
    } else {
      doc.setDrawColor(...T.border);
      doc.rect(restX, y, restW, ROW_H, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...T.textBody);
      const line = (doc.splitTextToSize(row.value || '—', restW - 5) as string[])[0] ?? '—';
      doc.text(line, restX + 2.5, y + 4.6);
    }
    y += ROW_H;
  }
  return y + 4;
}

/**
 * Renderiza texto libre respetando listas escritas por el usuario:
 * `- item`, `* item`, `• item` o `1. item`. La sangría inicial (2+ espacios)
 * genera un segundo nivel de viñeta.
 */
function drawRichText(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  text: string,
  pageW: number,
): number {
  const contentW = pageW - MARGIN * 2;
  const raw = (text || '').replace(/\r\n/g, '\n').trim();
  const lineH = 4.4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...T.textBody);

  if (!raw) {
    y = ensureSpace(doc, y, lineH + 1);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...T.muted);
    doc.text('Sin información registrada.', MARGIN + 2, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...T.textBody);
    return y + lineH + 3;
  }

  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) {
      y += lineH * 0.5;
      continue;
    }

    const indent = (/^[ \t]*/.exec(rawLine)?.[0] ?? '').replace(/\t/g, '  ').length;
    const level = indent >= 2 ? 1 : 0;
    const body = rawLine.trim();
    const bullet = /^[-*•·–—]\s+(.*)$/.exec(body);
    const numbered = /^(\d+[.)])\s+(.*)$/.exec(body);

    let markerX = MARGIN + 2;
    let textX = MARGIN + 2;
    let marker: 'dot' | 'dash' | null = null;
    let numberLabel = '';
    let content = body;

    if (bullet) {
      marker = level ? 'dash' : 'dot';
      markerX = MARGIN + 3 + level * 6;
      textX = markerX + 4;
      content = bullet[1] ?? '';
    } else if (numbered) {
      numberLabel = numbered[1] ?? '';
      markerX = MARGIN + 3 + level * 6;
      doc.setFont('helvetica', 'bold');
      textX = markerX + doc.getTextWidth(numberLabel) + 2;
      doc.setFont('helvetica', 'normal');
      content = numbered[2] ?? '';
    }

    const wrapped = doc.splitTextToSize(content || ' ', contentW - (textX - MARGIN) - 2) as string[];
    wrapped.forEach((line, i) => {
      y = ensureSpace(doc, y, lineH + 1);
      const baseline = y + 3;
      if (i === 0) {
        if (marker === 'dot') {
          doc.setFillColor(...T.primary);
          doc.circle(markerX + 0.8, baseline - 1.1, 0.75, 'F');
        } else if (marker === 'dash') {
          doc.setDrawColor(...T.muted);
          doc.setLineWidth(0.35);
          doc.line(markerX, baseline - 1.1, markerX + 2.2, baseline - 1.1);
          doc.setLineWidth(0.2);
        } else if (numberLabel) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...T.primary);
          doc.text(numberLabel, markerX, baseline);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...T.textBody);
        }
      }
      doc.text(line, textX, baseline);
      y += lineH;
    });
  }
  return y + 3;
}

/** Tabla de checklist: parte / condición / detalle. */
function drawChecklistTable(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  rows: { part: string; condition: string; detail: string }[],
  pageW: number,
): number {
  const contentW = pageW - MARGIN * 2;
  const wPart = contentW * 0.42;
  const wCond = contentW * 0.18;
  const wDetail = contentW - wPart - wCond;

  const header = (): void => {
    doc.setFillColor(...T.primary);
    doc.rect(MARGIN, y, contentW, 6.5, 'F');
    doc.setTextColor(T.white, T.white, T.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('PARTE / COMPONENTE', MARGIN + 2, y + 4.4);
    doc.text('CONDICIÓN', MARGIN + wPart + 2, y + 4.4);
    doc.text('Nº PARTE / OBSERVACIÓN', MARGIN + wPart + wCond + 2, y + 4.4);
    y += 6.5;
  };

  y = ensureSpace(doc, y, 6.5 + ROW_H);
  header();

  rows.forEach((row, index) => {
    const partLines = doc.splitTextToSize(row.part, wPart - 4) as string[];
    const detailLines = doc.splitTextToSize(row.detail || '—', wDetail - 4) as string[];
    const rowH = Math.max(6.5, Math.max(partLines.length, detailLines.length) * 3.6 + 3);
    const before = y;
    y = ensureSpace(doc, y, rowH);
    if (y !== before) header();

    doc.setDrawColor(...T.border);
    const bg: [number, number, number] =
      index % 2 === 0 ? T.stripe : [T.white, T.white, T.white];
    doc.setFillColor(...bg);
    doc.rect(MARGIN, y, wPart, rowH, 'FD');
    doc.rect(MARGIN + wPart, y, wCond, rowH, 'FD');
    doc.rect(MARGIN + wPart + wCond, y, wDetail, rowH, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...T.textBody);
    doc.text(partLines, MARGIN + 2, y + 4.4);
    doc.setFont('helvetica', 'bold');
    doc.text(row.condition, MARGIN + wPart + 2, y + 4.4);
    doc.setFont('helvetica', 'normal');
    doc.text(detailLines, MARGIN + wPart + wCond + 2, y + 4.4);
    y += rowH;
  });

  return y + 4;
}

async function preparePhotos(photos: ReportPhoto[]): Promise<PhotoReady[]> {
  const out: PhotoReady[] = [];
  for (const p of photos) {
    const url = p.photo_url?.trim();
    if (!url) continue;
    const dataUrl = await imageUrlToDataUrl(url);
    if (!dataUrl) continue;
    out.push({ dataUrl, note: (p.note || '').trim(), label: String(p.label || '') });
  }
  return out;
}

function captionFor(photo: PhotoReady, index: number): string {
  const desc = photo.note || photo.label || 'SIN DESCRIPCIÓN';
  return `IMAGEN ${index}. ${desc}`.toUpperCase();
}

/** Cuadrícula fotográfica 2×N con leyenda de color corporativo. */
function drawPhotoGrid(
  doc: jsPDF,
  T: PdfQuotationTheme,
  y: number,
  photos: PhotoReady[],
  startIndex: number,
  pageW: number,
): { y: number; nextIndex: number } {
  if (!photos.length) return { y, nextIndex: startIndex };

  const contentW = pageW - MARGIN * 2;
  const colW = (contentW - GAP) / 2;
  let idx = startIndex;

  for (let i = 0; i < photos.length; i += 2) {
    const pair = photos.slice(i, i + 2);
    const prepared = pair.map((photo) => {
      idx += 1;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      return {
        photo,
        lines: doc.splitTextToSize(captionFor(photo, idx), colW - 5) as string[],
      };
    });
    const capH = Math.max(9, ...prepared.map((item) => item.lines.length * 3.2 + 3.4));
    const cardH = PHOTO_HEIGHT + capH;
    y = ensureSpace(doc, y, cardH + 4);

    prepared.forEach(({ photo, lines }, col) => {
      const cardX = MARGIN + col * (colW + GAP);
      doc.setDrawColor(...T.border);
      doc.setLineWidth(0.3);
      doc.setFillColor(250, 250, 250);
      doc.rect(cardX, y, colW, PHOTO_HEIGHT, 'FD');

      let imgW = colW - 2;
      let imgH = PHOTO_HEIGHT - 2;
      try {
        const props = doc.getImageProperties(photo.dataUrl);
        const scale = Math.min(imgW / props.width, imgH / props.height);
        imgW = props.width * scale;
        imgH = props.height * scale;
      } catch {
        /* usa tamaño de reserva */
      }
      try {
        doc.addImage(
          photo.dataUrl,
          imageFormat(photo.dataUrl),
          cardX + (colW - imgW) / 2,
          y + (PHOTO_HEIGHT - imgH) / 2,
          imgW,
          imgH,
        );
      } catch {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...T.muted);
        doc.text('(imagen no disponible)', cardX + colW / 2, y + PHOTO_HEIGHT / 2, {
          align: 'center',
        });
      }

      doc.setFillColor(...T.primary);
      doc.rect(cardX, y + PHOTO_HEIGHT, colW, capH, 'F');
      doc.setTextColor(T.white, T.white, T.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(lines, cardX + 2.5, y + PHOTO_HEIGHT + 4.2);
    });

    y += cardH + 4;
    doc.setLineWidth(0.2);
  }
  doc.setTextColor(...T.textBody);
  return { y, nextIndex: idx };
}

function buildElectricalRows(ev: ElectricalEvaluation): ElectricalRow[] {
  const av = ev.actual_voltage;
  const main = ev.main_motor_current;
  const fan = ev.fan_motor_current;
  const nominal = String(ev.nominal_voltage ?? '');
  const starter = String(ev.starter_type ?? '');
  const control = String(ev.control_voltage ?? '');

  return [
    {
      kind: 'options',
      label: 'Voltaje nominal',
      options: [
        { text: '220 V', checked: nominal === '220V' },
        { text: '380 V', checked: nominal === '380V' },
        { text: '440 V', checked: nominal === '440V' },
      ],
    },
    {
      kind: 'phases',
      label: 'Voltaje real',
      cells: [
        { prefix: 'L1-L2', value: fmtNum(av?.l1_l2) },
        { prefix: 'L2-L3', value: fmtNum(av?.l2_l3) },
        { prefix: 'L3-L1', value: fmtNum(av?.l3_l1) },
      ],
    },
    {
      kind: 'phases',
      label: 'Corriente motor principal',
      cells: [
        { prefix: 'L1', value: fmtNum(main?.l1) },
        { prefix: 'L2', value: fmtNum(main?.l2) },
        { prefix: 'L3', value: fmtNum(main?.l3) },
      ],
    },
    {
      kind: 'phases',
      label: 'Corriente motor ventilador',
      cells: [
        { prefix: 'L1', value: fmtNum(fan?.l1) },
        { prefix: 'L2', value: fmtNum(fan?.l2) },
        { prefix: 'L3', value: fmtNum(fan?.l3) },
      ],
    },
    {
      kind: 'options',
      label: 'Arrancador tipo',
      options: [
        { text: 'Directo', checked: starter === 'DIRECT' },
        { text: 'Estrella-triángulo', checked: starter === 'STAR_DELTA' },
        { text: 'VSD', checked: starter === 'VSD' },
        { text: 'SOFT', checked: starter === 'SOFT' },
      ],
    },
    { kind: 'text', label: 'Marca de arrancador', value: ev.starter_brand || '' },
    {
      kind: 'options',
      label: 'Tensión de control',
      options: [
        { text: '110 VAC', checked: control === '110_VAC' },
        { text: '220 VAC', checked: control === '220_VAC' },
        { text: '24 VDC', checked: control === '24_VDC' },
      ],
    },
    { kind: 'text', label: 'Puesta a tierra', value: ev.grounding || '' },
  ];
}

/** Membrete: logo + empresa a la izquierda, ficha del informe a la derecha. */
function drawLetterhead(
  doc: jsPDF,
  T: PdfQuotationTheme,
  company: ReportPdfCompany,
  report: ServiceReport,
  correlativo: string,
  pageW: number,
): number {
  let y = MARGIN;
  let logoH = 0;

  if (company.logoDataUrl) {
    try {
      const props = doc.getImageProperties(company.logoDataUrl);
      const scale = Math.min(46 / props.width, 20 / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(company.logoDataUrl, imageFormat(company.logoDataUrl), MARGIN, y, w, h);
      logoH = h;
    } catch {
      logoH = 0;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...T.primary);
  doc.text(company.name || 'CLEO SYSTEM', MARGIN, y + logoH + (logoH ? 6 : 5));
  const leftBottom = y + logoH + (logoH ? 8 : 7);

  const boxW = 68;
  const boxH = 21;
  const boxX = pageW - MARGIN - boxW;
  doc.setDrawColor(...T.primary);
  doc.setLineWidth(0.4);
  doc.rect(boxX, y, boxW, boxH, 'S');
  doc.setLineWidth(0.2);

  const fields: [string, string][] = [
    ['INFORME N°', correlativo],
    ['FECHA', report.intervention_date || '—'],
    ['CONDICIÓN', conditionLabel(report.current_condition)],
  ];
  let fy = y + 5.5;
  for (const [label, value] of fields) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...T.muted);
    doc.text(label, boxX + 3, fy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...T.textBody);
    doc.text(value, boxX + 26, fy);
    fy += 6;
  }

  return Math.max(leftBottom, y + boxH) + 4;
}

/**
 * Genera y descarga el PDF técnico del informe (evaluación o servicio).
 * Usa el logo y la paleta `branding` de la empresa.
 */
export async function downloadServiceReportPdf(opts: {
  report: ServiceReport;
  machine: Machine;
  client: ReportPdfClient | null;
  company: ReportPdfCompany;
  photos?: ReportPhoto[];
}): Promise<void> {
  const { report, machine, client, company } = opts;
  const branding = { ...DEFAULT_COMPANY_BRANDING, ...(company.branding ?? {}) };
  const T = brandingToPdfTheme(branding);

  const photosSrc = (opts.photos?.length ? opts.photos : report.photos) ?? [];
  const sorted = photosSrc.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const before = await preparePhotos(sorted.filter((p) => p.label === 'BEFORE'));
  const during = await preparePhotos(sorted.filter((p) => p.label === 'DURING'));
  const after = await preparePhotos(sorted.filter((p) => p.label === 'AFTER'));
  const plateDataUrl = machine.plate_image_url?.trim()
    ? await imageUrlToDataUrl(machine.plate_image_url.trim())
    : null;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - MARGIN * 2;
  const isService = report.type === 'SERVICE';
  const correlativo = report.correlativo?.trim() || `#${report.id}`;
  const clientName = client?.name || machine.client_name || '—';
  let imageIndex = 0;

  let y = drawLetterhead(doc, T, company, report, correlativo, pageW);

  // Título principal
  doc.setFillColor(...T.primary);
  doc.rect(MARGIN, y, contentW, 11, 'F');
  doc.setTextColor(T.white, T.white, T.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(
    isService ? 'INFORME TÉCNICO DE SERVICIO' : 'INFORME TÉCNICO DE EVALUACIÓN',
    pageW / 2,
    y + 7.2,
    { align: 'center' },
  );
  y += 14;

  // Datos del cliente
  y = drawSpecTable(
    doc,
    T,
    y,
    [
      { label: 'Cliente', value: clientName },
      { label: 'RUC', value: client?.ruc || '—' },
      { label: 'Dirección', value: client?.address || '—' },
      { label: 'Elaborado por', value: report.created_by_name || '—' },
    ],
    pageW,
  );

  // Numeración correlativa: las secciones sin contenido no se imprimen.
  let sectionNo = 0;
  const section = (title: string, minFollowing = 12): void => {
    sectionNo += 1;
    y = drawSectionBanner(doc, T, y, `${sectionNo}. ${title}`, pageW, minFollowing);
  };

  section('Información del equipo', 30);
  y = drawSpecTable(
    doc,
    T,
    y,
    [
      { label: 'Marca', value: machine.brand_name || '—' },
      { label: 'Modelo', value: machine.model || '—' },
      { label: 'Nº de serie', value: machine.serial_number || '—' },
      { label: 'Categoría', value: machine.category_name || '—' },
      { label: 'Subcategoría', value: machine.subcategory_name || '—' },
      { label: 'Ubicación', value: machine.location || '—' },
      { label: 'Estado', value: statusLabel(machine.status) },
      {
        label: 'Horas diarias',
        value: machine.daily_working_hours != null ? String(machine.daily_working_hours) : '—',
      },
      {
        label: 'Horómetro informe',
        value: report.hour_meter != null ? String(report.hour_meter) : '—',
      },
      {
        label: 'Horómetro máquina',
        value: machine.current_hour_meter != null ? String(machine.current_hour_meter) : '—',
      },
    ],
    pageW,
  );

  if (plateDataUrl) {
    const boxW = 62;
    const boxH = 32;
    y = ensureSpace(doc, y, boxH + 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...T.textCaption);
    doc.text('PLACA DEL EQUIPO', MARGIN, y + 3);
    y += 5;
    doc.setDrawColor(...T.border);
    doc.setFillColor(250, 250, 250);
    doc.rect(MARGIN, y, boxW, boxH, 'FD');
    try {
      const props = doc.getImageProperties(plateDataUrl);
      const scale = Math.min((boxW - 2) / props.width, (boxH - 2) / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(
        plateDataUrl,
        imageFormat(plateDataUrl),
        MARGIN + (boxW - w) / 2,
        y + (boxH - h) / 2,
        w,
        h,
      );
    } catch {
      /* omite la placa si no se puede incrustar */
    }
    y += boxH + 5;
  }

  const ev =
    report.current_condition !== 'INOPERATIVE'
      ? report.electrical_evaluation || machine.electrical_evaluation
      : null;
  if (ev) {
    y = drawElectricalTable(doc, T, y, buildElectricalRows(ev), pageW);
  }

  section('Antecedentes', before.length ? 74 : 18);
  y = drawRichText(doc, T, y, report.background || '', pageW);
  if (before.length) {
    y = drawSubheading(doc, T, y, 'Registro fotográfico — antes');
    ({ y, nextIndex: imageIndex } = drawPhotoGrid(doc, T, y, before, imageIndex, pageW));
  }

  section(isService ? 'Trabajos realizados' : 'Inspecciones realizadas', 20);
  y = drawRichText(doc, T, y, report.work_performed || '', pageW);

  if (!isService && report.part_checks?.length) {
    y = drawSubheading(doc, T, y, 'Checklist de partes');
    y = drawChecklistTable(
      doc,
      T,
      y,
      report.part_checks.map((c) => ({
        part: c.recommended_part_name || `Parte #${c.recommended_part}`,
        condition: partCondLabel(c.condition),
        detail: [c.part_number ? `Nº ${c.part_number}` : null, c.notes || null]
          .filter(Boolean)
          .join(' · '),
      })),
      pageW,
    );
  }

  if (during.length) {
    section('Panel fotográfico', 72);
    ({ y, nextIndex: imageIndex } = drawPhotoGrid(doc, T, y, during, imageIndex, pageW));
  }

  section('Conclusiones', after.length ? 72 : 18);
  y = drawRichText(doc, T, y, report.conclusions || '', pageW);
  if (after.length) {
    y = drawSubheading(doc, T, y, 'Registro fotográfico — después');
    ({ y, nextIndex: imageIndex } = drawPhotoGrid(doc, T, y, after, imageIndex, pageW));
  }

  section('Recomendaciones', 18);
  drawRichText(doc, T, y, report.recommendations || '', pageW);

  // Cabecera y pie en todas las páginas
  const pageH = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...T.muted);
      doc.text(company.name || '', MARGIN, 13);
      doc.text(
        `${isService ? 'INFORME DE SERVICIO' : 'INFORME DE EVALUACIÓN'} · ${correlativo}`,
        pageW - MARGIN,
        13,
        { align: 'right' },
      );
    }
    doc.setDrawColor(...T.primary);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, pageH - 12, pageW - MARGIN, pageH - 12);
    doc.setLineWidth(0.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...T.muted);
    doc.text(clientName, MARGIN, pageH - 8);
    doc.text(`Página ${i} de ${pageCount}`, pageW - MARGIN, pageH - 8, { align: 'right' });
  }

  doc.save(`informe-${correlativo.replace(/[^\w.-]+/g, '_')}.pdf`);
}
