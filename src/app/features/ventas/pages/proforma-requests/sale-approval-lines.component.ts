import { Component, computed, input, output } from '@angular/core';
import {
  approvalChoicesError,
  draftGroups,
  formatQty,
  purchaseQty,
  type ApprovalChoice,
} from '../../utils/sale-approval';
import type { QuotationMoney } from '../../models/ventas.models';

@Component({
  selector: 'app-sale-approval-lines',
  templateUrl: './sale-approval-lines.component.html',
})
export class SaleApprovalLinesComponent {
  readonly choices = input.required<ApprovalChoice[]>();
  readonly money = input<QuotationMoney>('USD');
  readonly disabled = input(false);
  readonly offerDebug = input<string | null>(null);
  readonly choicesChange = output<ApprovalChoice[]>();

  readonly issue = computed(() => approvalChoicesError(this.choices()));
  readonly groups = computed(() => draftGroups(this.choices(), this.money()));
  readonly missingSupplier = computed(() =>
    this.choices().some((row) => purchaseQty(row) > 0 && !row.supplierName),
  );

  qty(value: number): string {
    return formatQty(value);
  }

  toBuy(row: ApprovalChoice): number {
    return purchaseQty(row);
  }

  setAccepted(lineId: number, raw: string): void {
    this.patch(lineId, (row) => {
      const accepted = soldQty(raw);
      return { ...row, acceptedQty: accepted, stockQty: Math.min(row.stockQty, accepted) };
    });
  }

  setStock(lineId: number, raw: string): void {
    this.patch(lineId, (row) => ({
      ...row,
      stockQty: clamp(wholeQty(raw), 0, row.acceptedQty),
    }));
  }

  removeRow(lineId: number): void {
    if (this.disabled()) return;
    this.choicesChange.emit(this.choices().filter((row) => row.lineId !== lineId));
  }

  private patch(lineId: number, change: (row: ApprovalChoice) => ApprovalChoice): void {
    this.choicesChange.emit(this.choices().map((row) => (row.lineId === lineId ? change(row) : row)));
  }
}

function wholeQty(raw: string): number {
  const n = Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function soldQty(raw: string): number {
  return Math.max(1, wholeQty(raw));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
