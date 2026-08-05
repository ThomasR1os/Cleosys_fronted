import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Product } from '../../../almacen/models/almacen.models';

export type FichaPdfParam = { parametro: string; valor: string };

/** Extrae pares parámetro/valor desde datasheet (líneas `clave: valor` o `clave = valor`). */
export function parseDatasheetParams(datasheet: string | null | undefined): FichaPdfParam[] {
  const text = datasheet?.trim() ?? '';
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pairs: FichaPdfParam[] = [];
  let fallbackLines: string[] = [];

  for (const line of lines) {
    const m = line.match(/^([^:=]{1,80})\s*[:=]\s*(.+)$/);
    if (m) {
      pairs.push({ parametro: m[1]!.trim(), valor: m[2]!.trim() });
    } else {
      fallbackLines.push(line);
    }
  }

  if (pairs.length === 0) {
    return [{ parametro: 'Especificaciones', valor: text }];
  }
  if (fallbackLines.length) {
    pairs.push({ parametro: 'Notas', valor: fallbackLines.join('\n') });
  }
  return pairs;
}

/** Filas del cuadro ficha técnica: campos fijos + datasheet. */
export function buildFichaPdfRows(product: Product): FichaPdfParam[] {
  const rows: FichaPdfParam[] = [];
  if (product.sku?.trim()) {
    rows.push({ parametro: 'SKU', valor: product.sku.trim() });
  }
  if (product.warranty?.trim()) {
    rows.push({ parametro: 'Garantía', valor: product.warranty.trim() });
  }
  if (product.dimensions?.trim()) {
    rows.push({ parametro: 'Dimensiones', valor: product.dimensions.trim() });
  }
  if (product.gross_weight?.trim()) {
    rows.push({ parametro: 'Peso bruto', valor: product.gross_weight.trim() });
  }
  rows.push(...parseDatasheetParams(product.datasheet));
  return rows;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/** Descarga una URL de imagen a data URL (CORS). */
export async function imageUrlToDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function dataUrlFormat(dataUrl: string): 'JPEG' | 'PNG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

function probeImageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Genera y abre en una pestaña el PDF de ficha técnica:
 * título (descripción) → imagen → cuadro Parámetro / Valor.
 */
export async function openProductFichaPdf(opts: {
  product: Product;
  imageDataUrl?: string | null;
  catalogExtras?: FichaPdfParam[];
}): Promise<void> {
  const { product, imageDataUrl, catalogExtras = [] } = opts;
  const title = (product.description || product.sku || 'Producto').trim();
  const rows = [...catalogExtras, ...buildFichaPdfRows(product)];

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(title, contentW) as string[];
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7 + 6;

  if (imageDataUrl) {
    const size = await probeImageSize(imageDataUrl);
    const maxW = Math.min(contentW, 90);
    const maxH = 70;
    let imgW = maxW;
    let imgH = maxH;
    if (size && size.w > 0 && size.h > 0) {
      const ratio = size.w / size.h;
      imgW = maxW;
      imgH = imgW / ratio;
      if (imgH > maxH) {
        imgH = maxH;
        imgW = imgH * ratio;
      }
    }
    const x = margin + (contentW - imgW) / 2;
    try {
      doc.addImage(imageDataUrl, dataUrlFormat(imageDataUrl), x, y, imgW, imgH);
      y += imgH + 10;
    } catch {
      /* imagen opcional */
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Ficha técnica', margin, y);
  y += 4;

  const body =
    rows.length > 0
      ? rows.map((r) => [r.parametro, r.valor])
      : [['—', 'Sin datos de ficha técnica']];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Parámetro', 'Valor']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 10,
      cellPadding: 3,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: 255,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: contentW * 0.35, fontStyle: 'bold' },
      1: { cellWidth: contentW * 0.65 },
    },
  });

  const safeName = (product.sku || String(product.id)).replace(/[^\w.-]+/g, '_');
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup bloqueado: forzar descarga
    const a = document.createElement('a');
    a.href = url;
    a.download = `ficha-tecnica-${safeName}.pdf`;
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
