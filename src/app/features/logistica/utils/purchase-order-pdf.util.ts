import { HttpClient } from '@angular/common/http';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { firstValueFrom } from 'rxjs';
import type { CompanyService } from '../../admin/services/company.service';
import {
  brandingToPdfTheme,
  DEFAULT_COMPANY_BRANDING,
  type PdfQuotationTheme,
} from '../../admin/utils/company-branding.utils';
import { imageUrlToDataUrl } from '../../core/pages/productos/product-ficha-pdf.util';
import type { Supplier } from '../../core/models/supplier.model';
import {
  formatIsoDate,
  formatPurchaseMoney,
  purchaseOrderProductLabel,
  purchaseOrderStatusLabel,
  type PurchaseOrder,
  type PurchaseOrderTotals,
} from '../models/purchase-order.models';

export interface PurchaseOrderPdfLine {
  product: number;
  product_sku: string;
  product_description: string;
  cant: string;
  unit_cost: string;
  received_qty: string;
}

const MARGIN = 14;

export async function openPurchaseOrderPdf(deps: {
  http: HttpClient;
  companyApi: CompanyService;
  companyId: number | null;
  companyName: string;
  fallbackLogoUrl?: string | null;
  order: PurchaseOrder;
  lines: PurchaseOrderPdfLine[];
  supplier: Supplier | null;
  warehouseLabel: string;
  paymentMethodName: string;
  totals: PurchaseOrderTotals;
}): Promise<void> {
  const company = await loadCompanyContext(deps);
  const doc = drawPurchaseOrderPdf(deps, company);
  const supplierName = deps.supplier?.name?.trim() || `Proveedor ${deps.order.supplier || deps.order.id}`;
  const filename = purchaseOrderPdfFilename(ocNumberYearCode(deps.order), supplierName, company.name);
  const url = URL.createObjectURL(doc.output('blob'));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** `OC-número-año`, tomando el número del correlativo y el año de la orden. */
function ocNumberYearCode(order: PurchaseOrder): string {
  const year = order.created_at?.match(/^(\d{4})/)?.[1] ?? String(new Date().getFullYear());
  const raw = order.correlativo.trim();
  const already = raw.match(/^OC-(\d+)-(\d{4})$/i);
  if (already) return `OC-${already[1]}-${already[2]}`;

  const numbers = raw.match(/\d+/g) ?? [];
  const number = numbers.find((part) => part !== year) ?? String(order.id);
  return `OC-${number}-${year}`;
}

function purchaseOrderPdfFilename(correlativo: string, supplierName: string, companyName: string): string {
  const parts = [correlativo, supplierName, companyName].map(sanitizeFilePart).filter(Boolean);
  return `${parts.join(' - ') || 'orden-de-compra'}.pdf`;
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function drawPurchaseOrderPdf(
  deps: {
    order: PurchaseOrder;
    lines: PurchaseOrderPdfLine[];
    supplier: Supplier | null;
    warehouseLabel: string;
    paymentMethodName: string;
    totals: PurchaseOrderTotals;
  },
  company: { name: string; ruc: string; address: string; logoDataUrl: string | null; theme: PdfQuotationTheme },
): jsPDF {
  const { order, lines, supplier, warehouseLabel, paymentMethodName, totals } = deps;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const theme = company.theme;
  const correlativo = order.correlativo.trim() || `OC-${order.id}`;
  const money = order.money;

  let y = drawLetterhead(doc, theme, company, order, correlativo, pageW);

  const left = supplierBlock(order, supplier);
  const right: [string, string][] = [
    ['Moneda', money],
    ['Forma de pago', paymentMethodName || '—'],
    ['Plazo', order.payment_terms.trim() || '—'],
    ['Incoterm', order.incoterm.trim() || '—'],
    ['Entrega', formatIsoDate(order.expected_delivery_date)],
    ['Almacén', warehouseLabel || '—'],
    ['Ref. proveedor', order.supplier_reference.trim() || '—'],
  ];
  y = drawMetaColumns(doc, theme, y, pageW, left, right);
  y += 4;

  const body = lines.length
    ? lines.map((line, index) => [
        String(index + 1),
        line.product_sku || '—',
        line.product_description || purchaseOrderProductLabel(line),
        formatQty(line.cant),
        formatPurchaseMoney(line.unit_cost, money),
        formatQty(line.received_qty),
        formatPurchaseMoney(lineAmountSafe(line.cant, line.unit_cost), money),
      ])
    : [['—', '—', 'Sin líneas', '—', '—', '—', '—']];

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [['#', 'SKU', 'Descripción', 'Cant.', 'Costo unit.', 'Recibido', 'Importe']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 1.6,
      textColor: theme.textBody,
      lineColor: theme.border,
      valign: 'middle',
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: theme.stripe },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 28 },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 26, halign: 'right' },
    },
  });

  y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
  y = drawTotals(doc, theme, y, pageW, money, totals);
  y = drawNotes(doc, theme, y, pageW, order.notes);
  drawFooters(doc, theme, pageW, company.name, correlativo);
  return doc;
}

function drawLetterhead(
  doc: jsPDF,
  theme: PdfQuotationTheme,
  company: { name: string; ruc: string; address: string; logoDataUrl: string | null },
  order: PurchaseOrder,
  correlativo: string,
  pageW: number,
): number {
  let y = MARGIN;
  let textX = MARGIN;
  if (company.logoDataUrl) {
    try {
      const props = doc.getImageProperties(company.logoDataUrl);
      const scale = Math.min(36 / props.width, 16 / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(company.logoDataUrl, dataUrlFormat(company.logoDataUrl), MARGIN, y, w, h);
      textX = MARGIN + w + 4;
    } catch {
      textX = MARGIN;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...theme.primary);
  doc.text(company.name || 'Empresa', textX, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...theme.muted);
  const meta = [company.ruc ? `RUC ${company.ruc}` : '', company.address].filter(Boolean).join(' · ');
  if (meta) doc.text(doc.splitTextToSize(meta, 90) as string[], textX, y + 10);

  const boxW = 62;
  const boxH = 22;
  const boxX = pageW - MARGIN - boxW;
  doc.setDrawColor(...theme.primary);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, y, boxW, boxH, 1, 1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...theme.primary);
  doc.text('ORDEN DE COMPRA', boxX + boxW / 2, y + 6, { align: 'center' });
  doc.setFontSize(11);
  doc.text(correlativo, boxX + boxW / 2, y + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...theme.muted);
  const issued = formatIsoDate(order.created_at) !== '—' ? formatIsoDate(order.created_at) : formatIsoDate(todayIso());
  doc.text(`${issued}  ·  ${purchaseOrderStatusLabel(order.status)}`, boxX + boxW / 2, y + 17.5, {
    align: 'center',
  });

  y = Math.max(y + 20, y + boxH) + 3;
  doc.setDrawColor(...theme.primary);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 6;
}

function drawMetaColumns(
  doc: jsPDF,
  theme: PdfQuotationTheme,
  y: number,
  pageW: number,
  supplierLines: string[],
  facts: [string, string][],
): number {
  const colW = (pageW - MARGIN * 2 - 6) / 2;
  const rightX = MARGIN + colW + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...theme.muted);
  doc.text('PROVEEDOR', MARGIN, y);
  doc.text('CONDICIONES', rightX, y);
  let leftY = y + 4;
  doc.setTextColor(...theme.textBody);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  const nameLines = doc.splitTextToSize(supplierLines[0] || '—', colW) as string[];
  doc.text(nameLines, MARGIN, leftY);
  leftY += nameLines.length * 4.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const line of supplierLines.slice(1)) {
    const wrapped = doc.splitTextToSize(line, colW) as string[];
    doc.text(wrapped, MARGIN, leftY);
    leftY += wrapped.length * 3.6;
  }

  let rightY = y + 4;
  for (const [label, value] of facts) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.muted);
    doc.text(label, rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...theme.textBody);
    const wrapped = doc.splitTextToSize(value, colW - 28) as string[];
    doc.text(wrapped, rightX + 28, rightY);
    rightY += Math.max(wrapped.length * 3.6, 4.2);
  }
  return Math.max(leftY, rightY);
}

function drawTotals(
  doc: jsPDF,
  theme: PdfQuotationTheme,
  y: number,
  pageW: number,
  money: PurchaseOrder['money'],
  totals: PurchaseOrderTotals,
): number {
  const hasDiscount = totals.discountPct > 0 || totals.discountAmount > 0.004;
  const hasTax = totals.taxPct > 0 || totals.taxAmount > 0.004;
  const rows: [string, string, boolean][] = [
    ['Subtotal', formatPurchaseMoney(totals.subtotal, money), false],
  ];
  if (hasDiscount) {
    rows.push([
      `Descuento (${totals.discountPct.toFixed(2)}%)`,
      formatPurchaseMoney(totals.discountAmount, money),
      false,
    ]);
    rows.push(['Base imponible', formatPurchaseMoney(totals.base, money), false]);
  }
  if (hasTax) {
    rows.push([`IGV (${totals.taxPct.toFixed(2)}%)`, formatPurchaseMoney(totals.taxAmount, money), false]);
  }
  rows.push(['TOTAL', formatPurchaseMoney(totals.total, money), true]);
  const boxW = 78;
  const boxH = 8 + rows.length * 5.2;
  y = ensureSpace(doc, y, boxH + 8);
  const x = pageW - MARGIN - boxW;
  doc.setFillColor(...theme.primaryLight);
  doc.setDrawColor(...theme.border);
  doc.roundedRect(x, y, boxW, boxH, 1, 1, 'FD');
  let rowY = y + 5;
  for (const [label, value, emphasis] of rows) {
    doc.setFont('helvetica', emphasis ? 'bold' : 'normal');
    doc.setFontSize(emphasis ? 10 : 8);
    doc.setTextColor(...(emphasis ? theme.totalBar : theme.textBody));
    doc.text(label, x + 3, rowY);
    doc.text(value, x + boxW - 3, rowY, { align: 'right' });
    rowY += emphasis ? 6 : 5;
  }
  y += boxH + 2;
  if (totals.source === 'preview') {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...theme.muted);
    doc.text('Vista previa según líneas y porcentajes. El servidor confirma los totales al guardar.', pageW - MARGIN, y + 2, {
      align: 'right',
    });
    y += 5;
  }
  return y + 2;
}

function drawNotes(doc: jsPDF, theme: PdfQuotationTheme, y: number, pageW: number, notes: string): number {
  const text = notes.trim();
  if (!text) return y;
  const width = pageW - MARGIN * 2;
  const wrapped = doc.splitTextToSize(text, width) as string[];
  y = ensureSpace(doc, y, 10 + wrapped.length * 3.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...theme.muted);
  doc.text('NOTAS', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...theme.textBody);
  doc.text(wrapped, MARGIN, y + 4);
  return y + 4 + wrapped.length * 3.6;
}

function drawFooters(doc: jsPDF, theme: PdfQuotationTheme, pageW: number, companyName: string, correlativo: string): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.muted);
    doc.text(`${companyName || 'Empresa'} · Orden de compra ${correlativo}`, MARGIN, pageH - 8);
    doc.text(`${i} / ${pages}`, pageW - MARGIN, pageH - 8, { align: 'right' });
  }
}

function supplierBlock(order: PurchaseOrder, supplier: Supplier | null): string[] {
  if (!supplier) return [`Proveedor #${order.supplier || '—'}`];
  const lines = [supplier.name || `Proveedor #${supplier.id}`];
  if (supplier.ruc?.trim()) lines.push(`RUC ${supplier.ruc.trim()}`);
  if (supplier.address?.trim()) lines.push(supplier.address.trim());
  const contact = [supplier.contact, supplier.phone, supplier.email].map((v) => v?.trim()).filter(Boolean);
  if (contact.length) lines.push(contact.join(' · '));
  return lines;
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 16) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function lineAmountSafe(cant: string, unitCost: string): number {
  const q = Number(cant);
  const c = Number(unitCost);
  if (!Number.isFinite(q) || !Number.isFinite(c)) return 0;
  return Math.round((q * c + Number.EPSILON) * 100) / 100;
}

function formatQty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dataUrlFormat(dataUrl: string): 'JPEG' | 'PNG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

async function loadCompanyContext(deps: {
  http: HttpClient;
  companyApi: CompanyService;
  companyId: number | null;
  companyName: string;
  fallbackLogoUrl?: string | null;
}): Promise<{ name: string; ruc: string; address: string; logoDataUrl: string | null; theme: PdfQuotationTheme }> {
  let name = deps.companyName.trim();
  let ruc = '';
  let address = '';
  let branding = { ...DEFAULT_COMPANY_BRANDING };
  let logoDataUrl: string | null = null;

  if (deps.companyId != null && deps.companyId > 0) {
    try {
      const company = await firstValueFrom(deps.companyApi.retrieve(deps.companyId));
      name = company.name?.trim() || name;
      ruc = company.ruc?.trim() ?? '';
      address = [company.address, company.district].filter((v) => v?.trim()).join(', ');
      if (company.branding) branding = { ...DEFAULT_COMPANY_BRANDING, ...company.branding };
      if (company.logo?.trim()) logoDataUrl = await imageUrlToDataUrl(company.logo.trim());
    } catch {
      /* la OC se emite igual con los datos de la sesión */
    }
  }

  if (!logoDataUrl && deps.fallbackLogoUrl?.trim()) {
    logoDataUrl = await imageUrlToDataUrl(deps.fallbackLogoUrl.trim());
  }
  if (!logoDataUrl) {
    for (const path of ['/branding/company-logo.png', '/branding/company-logo.jpg']) {
      try {
        const blob = await firstValueFrom(deps.http.get(path, { responseType: 'blob' }));
        if (!blob.size) continue;
        logoDataUrl = await blobToDataUrl(blob);
        if (logoDataUrl) break;
      } catch {
        continue;
      }
    }
  }

  return { name, ruc, address, logoDataUrl, theme: brandingToPdfTheme(branding) };
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
