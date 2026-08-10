import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
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
import { Company } from './company.entity';

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
};

@Injectable()
export class CorporateEmployeesService {
  constructor(
    @InjectRepository(CompanyEmployee)
    private readonly employees: Repository<CompanyEmployee>,
    @InjectRepository(CompanyInvite)
    private readonly invites: Repository<CompanyInvite>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly access: CorporateAccessService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private toDto(row: CompanyEmployee, enrollmentCode?: string): EmployeeDto {
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
    return rows.map((r) => this.toDto(r));
  }

  async countByStatus(companyId: string, status: CompanyEmployeeStatus): Promise<number> {
    return this.employees.count({ where: { companyId, status } });
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
        'SMS não configurado na API. Use e-mail ou copie o código manualmente.',
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
        'A ativação agora é feita no app ACAF Connect: abra Minha conta e informe o código de adesão da empresa.',
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
      `Use o app ACAF Connect (Minha conta) com o código de adesão da empresa: ${enrollmentCode}`,
    );
  }
}
