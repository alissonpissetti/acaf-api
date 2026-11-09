import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { normalizeHolderKey } from '../partner/checkIn';
import { getDomain, loadStore } from '../partner/store';
import type { ConnectPlanId } from '../partner/types';
import {
  getPartnerClientDetail,
  type PartnerClientCheckIn,
  type PartnerClientDetail,
} from '../partner/partnerClients';
import { SmsService } from '../sms/sms.service';
import { User, UserRole } from '../users/user.entity';
import {
  formatCpf,
  formatMobilePhone,
  isValidCpf,
  isValidMobilePhone,
  normalizeCpf,
  normalizeMobilePhone,
} from '../users/person.utils';
import { UsersService } from '../users/users.service';
import { CorporateAccessService } from './corporate-access.service';
import { CompanyEmployee, type CompanyEmployeeStatus } from './company-employee.entity';
import { CompanyInvite } from './company-invite.entity';
import { CompanyInvoice } from './company-invoice.entity';
import { Company } from './company.entity';
import { currentMonthKey } from './corporate-domain';

export type EmployeeMonthlyUsageRow = {
  employeeId: string;
  name: string;
  email: string;
  status: CompanyEmployeeStatus;
  /** Dias distintos com check-in de assinante (plano) no mês civil. */
  memberCheckInDaysInMonth: number;
  /** Dias distintos com uso de diária no mês civil. */
  dailyPassVisitDaysInMonth: number;
  subscriptionPlanId?: ConnectPlanId;
  subscriptionPlanName?: string;
  relationship: string;
};

export type PlanUsageInMonth = {
  subscriptionPlanId: string | null;
  subscriptionPlanName: string;
  /** Colaboradores com esse plano atual no app (entre os da empresa). */
  employeeCount: number;
  /** Soma dos dias-distintos de check-in de assinante no mês por colaborador neste plano. */
  sumMemberCheckInDays: number;
  /** Soma dos dias-distintos de diária no mês por colaborador neste plano. */
  sumDailyPassVisitDays: number;
};

export type EmployeesUsageReport = {
  monthKey: string;
  company: { id: string; tradeName: string; legalName: string };
  totals: {
    employees: number;
    memberCheckInDaysInMonth: number;
    dailyPassVisitDaysInMonth: number;
  };
  rows: EmployeeMonthlyUsageRow[];
  byPlan: PlanUsageInMonth[];
};

export type EmployeeDto = {
  id: string;
  userId: string;
  name: string;
  email: string;
  cpf: string | null;
  mobilePhone: string | null;
  status: CompanyEmployeeStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  enrollmentCode?: string;
  /** Situação de cobrança no mês civil atual (fatura corporativa). */
  billing?: {
    monthKey: string;
    /** Colaborador ativo entra no cálculo da fatura do mês (valor por ativo). */
    includedInMonthlyInvoice: boolean;
    /** `null` se ainda não há fatura gerada para o mês. */
    invoiceStatus: 'open' | 'paid' | null;
  };
};

@Injectable()
export class CorporateEmployeesService {
  constructor(
    @InjectRepository(CompanyEmployee)
    private readonly employees: Repository<CompanyEmployee>,
    @InjectRepository(CompanyInvite)
    private readonly invites: Repository<CompanyInvite>,
    @InjectRepository(CompanyInvoice)
    private readonly companyInvoices: Repository<CompanyInvoice>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly access: CorporateAccessService,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private toDto(row: CompanyEmployee, enrollmentCode?: string, billing?: EmployeeDto['billing']): EmployeeDto {
    const user = row.user;
    return {
      id: row.id,
      userId: row.userId,
      name: user?.name ?? '',
      email: user?.email ?? '',
      cpf: user?.cpf ? formatCpf(user.cpf) : null,
      mobilePhone: user?.mobilePhone ? formatMobilePhone(user.mobilePhone) : null,
      status: row.status,
      invitedAt: row.invitedAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      enrollmentCode,
      billing,
    };
  }

  private companyNameMatches(company: Company, detailCompanyName?: string | null): boolean {
    const cand = (detailCompanyName ?? '').trim().toLowerCase();
    if (!cand) return false;
    const a = company.tradeName?.trim().toLowerCase() ?? '';
    const b = company.legalName?.trim().toLowerCase() ?? '';
    return cand === a || cand === b || a.includes(cand) || cand.includes(a);
  }

  private connectPlanLabel(planId?: ConnectPlanId): string | undefined {
    if (!planId) return undefined;
    const domain = getDomain() as { connectPlans?: Array<{ id: string; name?: string }> };
    const plan = domain.connectPlans?.find((p) => p.id === planId);
    return plan?.name ?? planId;
  }

  private assertValidMonthKey(monthKey: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new BadRequestException('Parâmetro monthKey inválido. Use o formato AAAA-MM.');
    }
  }

  private distinctVisitDaysInMonth(
    checkIns: PartnerClientCheckIn[],
    monthPrefix: string,
    type: 'connect_member' | 'daily_pass',
  ): number {
    const days = new Set<string>();
    for (const c of checkIns) {
      if (c.type !== type) continue;
      if (!c.validatedAt.startsWith(monthPrefix)) continue;
      days.add(c.validatedAt.slice(0, 10));
    }
    return days.size;
  }

  private relationshipFromFilteredCheckIns(detail: PartnerClientDetail): string {
    let hadConnect = false;
    let hadDaily = false;
    for (const c of detail.checkIns ?? []) {
      if (c.type === 'connect_member') hadConnect = true;
      if (c.type === 'daily_pass') hadDaily = true;
    }
    const isPrimary = detail.isPrimaryMember;
    if (isPrimary && hadDaily) return 'mixed';
    if (isPrimary) return 'primary';
    if (hadConnect && hadDaily) return 'mixed';
    if (hadDaily) return 'daily_pass';
    if (hadConnect) return 'visitor';
    return 'visitor';
  }

  private filterUsageForCompany(company: Company, detail: PartnerClientDetail): PartnerClientDetail {
    const students = (detail.studentRecords ?? []).filter((s) =>
      this.companyNameMatches(company, s.companyName),
    );
    const checkIns = (detail.checkIns ?? []).filter((c) => {
      if (c.type === 'connect_member') return true;
      if (c.type === 'daily_pass') {
        return students.some((st) => st.unitId === c.unitId);
      }
      return false;
    });
    let primaryHistory = detail.primaryHistory;
    if (!this.companyNameMatches(company, detail.companyName) && students.length === 0) {
      primaryHistory = { ...detail.primaryHistory, changes: [] };
    }
    return {
      ...detail,
      studentRecords: students,
      checkIns,
      primaryHistory,
    };
  }

  private async enrollmentCodeFor(company: Company): Promise<string> {
    return this.access.ensureEnrollmentCode(company);
  }

  async listEmployees(companyId: string): Promise<EmployeeDto[]> {
    const rows = await this.employees.find({
      where: { companyId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    const company = await this.companies.findOne({ where: { id: companyId } });
    let billingBase: { monthKey: string; invoiceStatus: 'open' | 'paid' | null } | null = null;
    if (company) {
      const mk = currentMonthKey();
      const inv = await this.companyInvoices.findOne({
        where: { companyId: company.id, monthKey: mk },
      });
      billingBase = {
        monthKey: mk,
        invoiceStatus: inv?.status ?? null,
      };
    }
    return rows.map((r) => {
      const billing =
        billingBase != null
          ? {
              monthKey: billingBase.monthKey,
              includedInMonthlyInvoice: r.status === 'active',
              invoiceStatus: billingBase.invoiceStatus,
            }
          : undefined;
      return this.toDto(r, undefined, billing);
    });
  }

  async getEmployeeUsage(companyId: string, employeeId: string) {
    const row = await this.employees.findOne({
      where: { id: employeeId, companyId },
      relations: ['user'],
    });
    if (!row?.user) throw new NotFoundException('Colaborador não encontrado.');

    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const mk = currentMonthKey();
    const inv = await this.companyInvoices.findOne({
      where: { companyId: company.id, monthKey: mk },
    });

    const store = loadStore();
    const unitIds = store.units.map((u) => u.id);
    const holderKey = normalizeHolderKey(row.user.name);
    let detail = getPartnerClientDetail(store, unitIds, holderKey, 'all');
    if (!detail) {
      const empty: PartnerClientDetail = {
        holderKey,
        name: row.user.name.trim(),
        isPrimaryMember: false,
        totalCheckIns: 0,
        checkInsThisMonth: 0,
        dailyPassesTotal: 0,
        dailyPassesThisMonth: 0,
        relationship: 'visitor',
        checkIns: [],
        primaryHistory: { changes: [] },
        studentRecords: [],
      };
      detail = empty;
    }

    const filtered = this.filterUsageForCompany(company, detail);
    if (!filtered.email?.trim() && row.user.email) {
      filtered.email = row.user.email.trim();
    }
    if (!filtered.cpf && row.user.cpf) {
      filtered.cpf = formatCpf(row.user.cpf);
    }
    const employee = this.toDto(row, undefined, {
      monthKey: mk,
      includedInMonthlyInvoice: row.status === 'active',
      invoiceStatus: inv?.status ?? null,
    });

    return {
      employee,
      company: {
        id: company.id,
        tradeName: company.tradeName,
        legalName: company.legalName,
      },
      usage: filtered,
    };
  }

  async getEmployeesUsageReport(companyId: string, monthKey: string): Promise<EmployeesUsageReport> {
    const mk = monthKey.trim();
    this.assertValidMonthKey(mk);

    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const rows = await this.employees.find({
      where: { companyId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    const store = loadStore();
    const unitIds = store.units.map((u) => u.id);
    const monthPrefix = mk;

    const employeeRows: EmployeeMonthlyUsageRow[] = [];
    const planMap = new Map<
      string,
      {
        subscriptionPlanId: string | null;
        subscriptionPlanName: string;
        employeeCount: number;
        sumC: number;
        sumD: number;
      }
    >();

    const ensurePlan = (planId: string | null, planName: string) => {
      const key = planId ?? '__none__';
      let entry = planMap.get(key);
      if (!entry) {
        entry = {
          subscriptionPlanId: planId,
          subscriptionPlanName: planName,
          employeeCount: 0,
          sumC: 0,
          sumD: 0,
        };
        planMap.set(key, entry);
      }
      return entry;
    };

    for (const row of rows) {
      if (!row.user) continue;

      const holderKey = normalizeHolderKey(row.user.name);
      let detail = getPartnerClientDetail(store, unitIds, holderKey, 'all');
      if (!detail) {
        employeeRows.push({
          employeeId: row.id,
          name: row.user.name.trim(),
          email: row.user.email ?? '',
          status: row.status,
          memberCheckInDaysInMonth: 0,
          dailyPassVisitDaysInMonth: 0,
          relationship: 'visitor',
        });
        const none = ensurePlan(null, 'Sem plano');
        none.employeeCount += 1;
        continue;
      }

      const filtered = this.filterUsageForCompany(company, detail);
      const connectDays = this.distinctVisitDaysInMonth(filtered.checkIns, monthPrefix, 'connect_member');
      const dailyDays = this.distinctVisitDaysInMonth(filtered.checkIns, monthPrefix, 'daily_pass');
      const planId = filtered.primaryHistory?.connectPlanId ?? filtered.connectPlanId;
      const planName =
        filtered.primaryHistory?.connectPlanName ?? this.connectPlanLabel(planId) ?? 'Sem plano';

      employeeRows.push({
        employeeId: row.id,
        name: row.user.name.trim(),
        email: row.user.email?.trim() ?? '',
        status: row.status,
        memberCheckInDaysInMonth: connectDays,
        dailyPassVisitDaysInMonth: dailyDays,
        subscriptionPlanId: planId,
        subscriptionPlanName: planName,
        relationship: this.relationshipFromFilteredCheckIns(filtered),
      });

      const p = ensurePlan(planId ?? null, planName);
      p.employeeCount += 1;
      p.sumC += connectDays;
      p.sumD += dailyDays;
    }

    const byPlan: PlanUsageInMonth[] = [...planMap.values()]
      .map((p) => ({
        subscriptionPlanId: p.subscriptionPlanId,
        subscriptionPlanName: p.subscriptionPlanName,
        employeeCount: p.employeeCount,
        sumMemberCheckInDays: p.sumC,
        sumDailyPassVisitDays: p.sumD,
      }))
      .sort((a, b) =>
        a.subscriptionPlanName.localeCompare(b.subscriptionPlanName, 'pt-BR', { sensitivity: 'base' }),
      );

    const totals = employeeRows.reduce(
      (acc, r) => {
        acc.memberCheckInDaysInMonth += r.memberCheckInDaysInMonth;
        acc.dailyPassVisitDaysInMonth += r.dailyPassVisitDaysInMonth;
        return acc;
      },
      { memberCheckInDaysInMonth: 0, dailyPassVisitDaysInMonth: 0 },
    );

    return {
      monthKey: mk,
      company: {
        id: company.id,
        tradeName: company.tradeName,
        legalName: company.legalName,
      },
      totals: {
        employees: employeeRows.length,
        memberCheckInDaysInMonth: totals.memberCheckInDaysInMonth,
        dailyPassVisitDaysInMonth: totals.dailyPassVisitDaysInMonth,
      },
      rows: employeeRows,
      byPlan,
    };
  }

  async countByStatus(companyId: string, status: CompanyEmployeeStatus): Promise<number> {
    return this.employees.count({ where: { companyId, status } });
  }

  /**
   * No cadastro público da empresa, o gestor já tem usuário corporativo — cria o vínculo
   * em acaf_company_employees para aparecer na lista "Colaboradores" (mesmo fluxo que add manual).
   */
  async linkManagerUserAsEmployee(companyId: string, managerUserId: string): Promise<void> {
    const existing = await this.employees.findOne({
      where: { companyId, userId: managerUserId },
    });
    if (existing) return;

    await this.employees.save(
      this.employees.create({
        companyId,
        userId: managerUserId,
        status: 'pending',
        invitedAt: null,
        activatedAt: null,
      }),
    );
  }

  async addEmployee(
    company: Company,
    input: { name: string; email: string; cpf?: string; mobilePhone: string },
  ): Promise<EmployeeDto> {
    const name = input.name.trim();
    const email = input.email.toLowerCase().trim();
    if (!name || !email) {
      throw new BadRequestException('Informe nome e e-mail do colaborador.');
    }

    const mobilePhone = normalizeMobilePhone(input.mobilePhone);
    if (!isValidMobilePhone(mobilePhone)) {
      throw new BadRequestException('Informe um celular válido do colaborador.');
    }

    const cpfDigits = input.cpf ? normalizeCpf(input.cpf) : null;
    if (cpfDigits && !isValidCpf(cpfDigits)) {
      throw new BadRequestException('CPF inválido.');
    }

    let user = await this.usersService.findByEmail(email);
    if (!user && cpfDigits) {
      user = await this.usersService.findByCpf(cpfDigits);
    }

    if (user) {
      const existing = await this.employees.findOne({
        where: { companyId: company.id, userId: user.id },
      });
      if (existing) {
        throw new ConflictException('Colaborador já cadastrado nesta empresa.');
      }
      if (name) user.name = name;
      if (cpfDigits && !user.cpf) user.cpf = cpfDigits;
      user.mobilePhone = mobilePhone;
      await this.users.save(user);
    } else {
      user = await this.users.save(
        this.users.create({
          name,
          email,
          cpf: cpfDigits,
          mobilePhone,
          passwordHash: null,
          roles: [UserRole.MEMBER],
          active: true,
        }),
      );
    }

    const employee = await this.employees.save(
      this.employees.create({
        companyId: company.id,
        userId: user.id,
        status: 'pending',
        invitedAt: null,
        activatedAt: null,
      }),
    );

    employee.user = user;
    return this.toDto(employee);
  }

  /**
   * Cadastro em lote (portal corporativo). Reaproveita as mesmas regras de {@link addEmployee};
   * duplicatas na empresa viram linha ignorada, não interrompem o restante.
   */
  async addEmployeesBulk(
    company: Company,
    rows: Array<{ name: string; email: string; cpf?: string; mobilePhone: string }>,
  ): Promise<{
    created: number;
    skipped: number;
    failed: number;
    details: Array<{
      index: number;
      email?: string;
      outcome: 'created' | 'skipped' | 'error';
      message?: string;
    }>;
  }> {
    const max = 500;
    if (!Array.isArray(rows)) {
      throw new BadRequestException('Envie uma lista de colaboradores (employees).');
    }
    if (rows.length === 0) {
      throw new BadRequestException('A lista está vazia.');
    }
    if (rows.length > max) {
      throw new BadRequestException(`No máximo ${max} colaboradores por importação.`);
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const details: Array<{
      index: number;
      email?: string;
      outcome: 'created' | 'skipped' | 'error';
      message?: string;
    }> = [];

    const pushDetail = (
      index: number,
      email: string | undefined,
      outcome: 'created' | 'skipped' | 'error',
      message?: string,
    ) => {
      if (details.length >= 200) return;
      details.push({ index, email, outcome, message });
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        await this.addEmployee(company, row);
        created++;
        pushDetail(i + 1, row.email?.toLowerCase()?.trim(), 'created');
      } catch (e) {
        const email = typeof row.email === 'string' ? row.email.toLowerCase().trim() : undefined;
        if (e instanceof ConflictException) {
          skipped++;
          pushDetail(i + 1, email, 'skipped', e.message);
        } else if (e instanceof BadRequestException) {
          failed++;
          pushDetail(i + 1, email, 'error', e.message);
        } else {
          failed++;
          pushDetail(i + 1, email, 'error', 'Erro ao cadastrar.');
        }
      }
    }

    return { created, skipped, failed, details };
  }

  private async getEmployeeOrThrow(companyId: string, employeeId: string): Promise<CompanyEmployee> {
    const row = await this.employees.findOne({
      where: { id: employeeId, companyId },
      relations: ['user'],
    });
    if (!row) throw new NotFoundException('Colaborador não encontrado.');
    return row;
  }

  private assertCanShareCode(row: CompanyEmployee): void {
    if (row.status === 'active') {
      throw new BadRequestException('Colaborador já está ativo.');
    }
    if (row.status === 'inactive') {
      throw new BadRequestException('Reative o colaborador antes de enviar o código.');
    }
  }

  private async markCodeShared(employee: CompanyEmployee): Promise<void> {
    employee.status = 'invited';
    employee.invitedAt = new Date();
    await this.employees.save(employee);
  }

  async getEnrollmentCode(company: Company): Promise<{ enrollmentCode: string }> {
    const enrollmentCode = await this.enrollmentCodeFor(company);
    return { enrollmentCode };
  }

  async getInviteLink(company: Company, employeeId: string): Promise<{ enrollmentCode: string }> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanShareCode(row);
    const enrollmentCode = await this.enrollmentCodeFor(company);
    return { enrollmentCode };
  }

  async sendInviteEmail(company: Company, employeeId: string): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanShareCode(row);

    const enrollmentCode = await this.enrollmentCodeFor(company);
    const mailResult = await this.mail.sendEmployeeEnrollmentCode({
      to: row.user.email,
      employeeName: row.user.name,
      companyName: company.tradeName || company.legalName,
      enrollmentCode,
    });

    if (!mailResult.sent) {
      throw new BadRequestException(
        mailResult.reason ??
          'Não foi possível enviar o e-mail. Use "Copiar código" e envie manualmente ao colaborador.',
      );
    }

    await this.markCodeShared(row);
    return this.toDto(row, enrollmentCode);
  }

  async sendInviteSms(company: Company, employeeId: string): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanShareCode(row);

    const phone = row.user?.mobilePhone;
    if (!phone || !isValidMobilePhone(phone)) {
      throw new BadRequestException('Colaborador sem celular válido cadastrado.');
    }

    const enrollmentCode = await this.enrollmentCodeFor(company);

    const smsResult = await this.sms.sendEmployeeEnrollmentCode({
      to: phone,
      employeeName: row.user.name,
      companyName: company.tradeName || company.legalName,
      enrollmentCode,
    });

    if (!smsResult.sent) {
      throw new BadRequestException(
        'Envio ao celular não configurado na API. Use e-mail ou copie o código manualmente.',
      );
    }

    await this.markCodeShared(row);
    return this.toDto(row, enrollmentCode);
  }

  async updateEmployeeStatus(
    companyId: string,
    employeeId: string,
    status: CompanyEmployeeStatus,
  ): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(companyId, employeeId);
    row.status = status;
    if (status === 'active' && !row.activatedAt) row.activatedAt = new Date();
    const saved = await this.employees.save(row);
    return this.toDto(saved);
  }

  async resendInvite(company: Company, employeeId: string): Promise<EmployeeDto> {
    return this.sendInviteEmail(company, employeeId);
  }

  async removeEmployee(companyId: string, employeeId: string): Promise<void> {
    const row = await this.getEmployeeOrThrow(companyId, employeeId);
    await this.employees.remove(row);
  }

  async removeAllForCompany(companyId: string): Promise<void> {
    await this.invites.delete({ companyId });
    await this.employees.delete({ companyId });
  }

  /** Legado — ativação por link individual foi substituída pelo código no app. */
  async getInvitePreview(token: string) {
    const invite = await this.invites.findOne({
      where: { token },
      relations: ['company', 'employee', 'employee.user'],
    });
    if (!invite || invite.acceptedAt) {
      throw new NotFoundException('Convite inválido ou já utilizado.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Convite expirado.');
    }

    const enrollmentCode = await this.access.ensureEnrollmentCode(invite.company);

    return {
      email: invite.email,
      companyName: invite.company.tradeName || invite.company.legalName,
      expiresAt: invite.expiresAt.toISOString(),
      enrollmentCode,
      useApp: true,
      message:
        'A ativação agora é feita no aplicativo: abra Minha conta e informe o código de adesão da empresa.',
      suggestions: {
        name: invite.employee.user?.name?.trim() || undefined,
        cpf: invite.employee.user?.cpf ? formatCpf(invite.employee.user.cpf) : undefined,
        mobilePhone: invite.employee.user?.mobilePhone
          ? formatMobilePhone(invite.employee.user.mobilePhone)
          : undefined,
      },
    };
  }

  /** Legado — redireciona fluxo ao código compartilhado no app. */
  async acceptInvite(token: string, input: { password: string; cpf: string; name?: string }) {
    const invite = await this.invites.findOne({
      where: { token },
      relations: ['company', 'employee', 'employee.user'],
    });
    if (!invite || invite.acceptedAt) {
      throw new NotFoundException('Convite inválido ou já utilizado.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Convite expirado.');
    }

    const enrollmentCode = await this.access.ensureEnrollmentCode(invite.company);

    throw new BadRequestException(
      `Use o aplicativo (Minha conta) com o código de adesão da empresa: ${enrollmentCode}`,
    );
  }
}
