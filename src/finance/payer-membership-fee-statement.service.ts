import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CompanyInvoice } from '../corporate/company-invoice.entity';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { AccountReceivable } from './account-receivable.entity';
import { CashEntryStatus, effectiveCashEntryStatus } from './cash-entry.types';
import type { ReceivablePayerKind } from './receivable-counterparty.types';

export type MembershipFeeReceivableRow = {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  settledAt: string | null;
  status: CashEntryStatus;
  category: string | null;
};

export type MembershipFeeInvoiceRow = {
  id: string;
  monthKey: string;
  activeEmployees: number;
  unitAmount: number;
  totalAmount: number;
  status: string;
  generatedAt: string;
};

export type MembershipFeeMonthGroup = {
  monthKey: string;
  invoice: MembershipFeeInvoiceRow | null;
  receivables: MembershipFeeReceivableRow[];
  /** Soma dos recebíveis do mês (referência: vencimento). */
  totalReceivableAmount: number;
  /** Soma liquidada no mês. */
  totalPaidAmount: number;
};

function monthKeyFromDate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 7) return trimmed.slice(0, 7);
  return '';
}

function parseAmount(raw: string | number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function mapReceivableRow(row: AccountReceivable): MembershipFeeReceivableRow {
  return {
    id: row.id,
    description: row.description,
    amount: parseAmount(row.amount),
    dueDate: row.dueDate,
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    status: effectiveCashEntryStatus(row.status, row.dueDate, row.settledAt),
    category: row.category,
  };
}

function mapInvoiceRow(row: CompanyInvoice): MembershipFeeInvoiceRow {
  return {
    id: row.id,
    monthKey: row.monthKey,
    activeEmployees: row.activeEmployees,
    unitAmount: parseAmount(row.unitAmount),
    totalAmount: parseAmount(row.totalAmount),
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
  };
}

@Injectable()
export class PayerMembershipFeeStatementService {
  constructor(
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
    @InjectRepository(CompanyInvoice)
    private readonly companyInvoices: Repository<CompanyInvoice>,
    private readonly corporateAccess: CorporateAccessService,
  ) {}

  private async listReceivablesForPayer(kind: ReceivablePayerKind, refId: string) {
    return this.receivables.find({
      where: {
        payerKind: kind,
        payerRefId: refId,
        status: Not(CashEntryStatus.CANCELLED),
      },
      order: { dueDate: 'DESC', createdAt: 'DESC' },
    });
  }

  private buildMonthGroups(
    receivableRows: AccountReceivable[],
    invoices: CompanyInvoice[],
  ): MembershipFeeMonthGroup[] {
    const byMonth = new Map<string, MembershipFeeMonthGroup>();

    for (const inv of invoices) {
      const mk = inv.monthKey.trim();
      if (!mk) continue;
      const existing = byMonth.get(mk) ?? {
        monthKey: mk,
        invoice: null,
        receivables: [],
        totalReceivableAmount: 0,
        totalPaidAmount: 0,
      };
      existing.invoice = mapInvoiceRow(inv);
      byMonth.set(mk, existing);
    }

    for (const row of receivableRows) {
      const mk = monthKeyFromDate(row.dueDate);
      if (!mk) continue;
      const mapped = mapReceivableRow(row);
      const existing = byMonth.get(mk) ?? {
        monthKey: mk,
        invoice: null,
        receivables: [],
        totalReceivableAmount: 0,
        totalPaidAmount: 0,
      };
      existing.receivables.push(mapped);
      existing.totalReceivableAmount = Math.round((existing.totalReceivableAmount + mapped.amount) * 100) / 100;
      if (mapped.status === CashEntryStatus.SETTLED) {
        existing.totalPaidAmount = Math.round((existing.totalPaidAmount + mapped.amount) * 100) / 100;
      }
      byMonth.set(mk, existing);
    }

    return [...byMonth.values()].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }

  async listForCompany(companyId: string): Promise<MembershipFeeMonthGroup[]> {
    const company = await this.corporateAccess.findCompanyById(companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const [receivableRows, invoiceRows] = await Promise.all([
      this.listReceivablesForPayer('company', company.id),
      this.companyInvoices.find({
        where: { companyId: company.id },
        order: { monthKey: 'DESC' },
      }),
    ]);

    return this.buildMonthGroups(receivableRows, invoiceRows);
  }

  async listForPartnerNetwork(networkId: string): Promise<MembershipFeeMonthGroup[]> {
    const id = networkId.trim();
    if (!id) throw new NotFoundException('Rede não encontrada.');
    const receivableRows = await this.listReceivablesForPayer('partner', id);
    return this.buildMonthGroups(receivableRows, []);
  }
}