import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getDomain } from '../partner/store';
import { CompanyInvoice } from './company-invoice.entity';
import { Company } from './company.entity';
import { CorporateEmployeesService } from './corporate-employees.service';
import { currentMonthKey, getCorporateBenefitPerMonth } from './corporate-domain';

export type InvoiceDto = {
  id: string;
  monthKey: string;
  activeEmployees: number;
  unitAmount: number;
  totalAmount: number;
  status: string;
  generatedAt: string;
};

@Injectable()
export class CorporateInvoicesService {
  constructor(
    @InjectRepository(CompanyInvoice)
    private readonly invoices: Repository<CompanyInvoice>,
    private readonly employees: CorporateEmployeesService,
  ) {}

  private unitAmount(): number {
    return getCorporateBenefitPerMonth(getDomain() as { corporateBenefitPerMonth?: number });
  }

  private toDto(row: CompanyInvoice): InvoiceDto {
    return {
      id: row.id,
      monthKey: row.monthKey,
      activeEmployees: row.activeEmployees,
      unitAmount: Number(row.unitAmount),
      totalAmount: Number(row.totalAmount),
      status: row.status,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  async ensureInvoiceForCompany(company: Company, monthKey = currentMonthKey()): Promise<CompanyInvoice> {
    const activeEmployees = await this.employees.countByStatus(company.id, 'active');
    const unitAmount = this.unitAmount();
    const totalAmount = Math.round(activeEmployees * unitAmount * 100) / 100;

    let row = await this.invoices.findOne({ where: { companyId: company.id, monthKey } });
    if (!row) {
      row = this.invoices.create({
        companyId: company.id,
        monthKey,
        activeEmployees,
        unitAmount,
        totalAmount,
        status: 'open',
      });
    } else {
      row.activeEmployees = activeEmployees;
      row.unitAmount = unitAmount;
      row.totalAmount = totalAmount;
    }
    return this.invoices.save(row);
  }

  async listInvoices(company: Company): Promise<InvoiceDto[]> {
    await this.ensureInvoiceForCompany(company);
    const rows = await this.invoices.find({
      where: { companyId: company.id },
      order: { monthKey: 'DESC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getInvoice(company: Company, monthKey: string): Promise<InvoiceDto> {
    const row = await this.ensureInvoiceForCompany(company, monthKey);
    if (row.companyId !== company.id) throw new NotFoundException('Fatura não encontrada.');
    return this.toDto(row);
  }
}
