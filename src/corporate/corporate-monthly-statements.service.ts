import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { getDomain } from '../partner/store';
import type { ConnectPlanId } from '../partner/types';
import { resolveConnectPlanQuote, roundMoney } from '../partner/connect-plan-pricing';
import { CorporateAccessService } from './corporate-access.service';
import { CompanyInvoice } from './company-invoice.entity';
import {
  CorporateEmployeesService,
  type EmployeesUsageReport,
  type PlanUsageInMonth,
} from './corporate-employees.service';
import { currentMonthKey, getCorporateBenefitPerMonth } from './corporate-domain';

export type MonthlyStatementListItem = {
  monthKey: string;
  activeEmployees: number;
  unitAmount: number;
  totalAmount: number;
  status: string;
  generatedAt: string;
};

export type PlanBillingInStatement = PlanUsageInMonth & {
  planMonthlyAmount: number | null;
  corporateBenefitPerMonth: number;
  employeePortionPerMonth: number | null;
  estimatedCompanyAmount: number;
  estimatedEmployeeAmount: number;
};

export type MonthlyStatementDetail = {
  monthKey: string;
  company: EmployeesUsageReport['company'];
  invoice: MonthlyStatementListItem;
  usage: EmployeesUsageReport;
  billing: {
    corporateBenefitPerMonth: number;
    companyTotalAmount: number;
    estimatedEmployeeSubscriptionTotal: number;
    byPlan: PlanBillingInStatement[];
  };
};

@Injectable()
export class CorporateMonthlyStatementsService {
  constructor(
    @InjectRepository(CompanyInvoice)
    private readonly invoices: Repository<CompanyInvoice>,
    private readonly access: CorporateAccessService,
    private readonly employees: CorporateEmployeesService,
  ) {}

  private assertValidMonthKey(monthKey: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new BadRequestException('Parâmetro monthKey inválido. Use o formato AAAA-MM.');
    }
  }

  private assertClosedMonth(monthKey: string): void {
    this.assertValidMonthKey(monthKey);
    const current = currentMonthKey();
    if (monthKey >= current) {
      throw new BadRequestException('Apenas meses encerrados podem ser consultados no extrato.');
    }
  }

  private toListItem(row: CompanyInvoice): MonthlyStatementListItem {
    return {
      monthKey: row.monthKey,
      activeEmployees: row.activeEmployees,
      unitAmount: Number(row.unitAmount),
      totalAmount: Number(row.totalAmount),
      status: row.status,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  private planBillingRows(
    usage: EmployeesUsageReport,
    corporateBenefitPerMonth: number,
  ): PlanBillingInStatement[] {
    return usage.byPlan.map((plan) => {
      let planMonthlyAmount: number | null = null;
      let employeePortionPerMonth: number | null = null;
      if (plan.subscriptionPlanId) {
        try {
          const quote = resolveConnectPlanQuote(plan.subscriptionPlanId as ConnectPlanId);
          planMonthlyAmount = quote.monthlyAmount;
          employeePortionPerMonth = roundMoney(
            Math.max(0, planMonthlyAmount - corporateBenefitPerMonth),
          );
        } catch {
          planMonthlyAmount = null;
          employeePortionPerMonth = null;
        }
      }
      const estimatedCompanyAmount = roundMoney(plan.employeeCount * corporateBenefitPerMonth);
      const estimatedEmployeeAmount =
        employeePortionPerMonth != null
          ? roundMoney(plan.employeeCount * employeePortionPerMonth)
          : 0;
      return {
        ...plan,
        planMonthlyAmount,
        corporateBenefitPerMonth,
        employeePortionPerMonth,
        estimatedCompanyAmount,
        estimatedEmployeeAmount,
      };
    });
  }

  async listClosedStatements(companyId: string): Promise<MonthlyStatementListItem[]> {
    const company = await this.access.findCompanyById(companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const current = currentMonthKey();
    const rows = await this.invoices.find({
      where: { companyId: company.id, monthKey: LessThan(current) },
      order: { monthKey: 'DESC' },
    });
    return rows.map((r) => this.toListItem(r));
  }

  async getStatement(companyId: string, monthKey: string): Promise<MonthlyStatementDetail> {
    this.assertClosedMonth(monthKey);

    const company = await this.access.findCompanyById(companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const row = await this.invoices.findOne({
      where: { companyId: company.id, monthKey },
    });
    if (!row) {
      throw new NotFoundException('Extrato não encontrado para este mês.');
    }

    const usage = await this.employees.getEmployeesUsageReport(company.id, monthKey);
    const corporateBenefitPerMonth = getCorporateBenefitPerMonth(
      getDomain() as { corporateBenefitPerMonth?: number },
    );
    const byPlan = this.planBillingRows(usage, corporateBenefitPerMonth);
    const estimatedEmployeeSubscriptionTotal = roundMoney(
      byPlan.reduce((sum, p) => sum + p.estimatedEmployeeAmount, 0),
    );

    return {
      monthKey,
      company: usage.company,
      invoice: this.toListItem(row),
      usage,
      billing: {
        corporateBenefitPerMonth,
        companyTotalAmount: Number(row.totalAmount),
        estimatedEmployeeSubscriptionTotal,
        byPlan,
      },
    };
  }
}