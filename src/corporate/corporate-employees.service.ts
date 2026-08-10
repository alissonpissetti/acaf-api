import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
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
  inviteUrl?: string;
};

const INVITE_DAYS = 7;

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
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private toDto(row: CompanyEmployee, inviteUrl?: string): EmployeeDto {
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
      inviteUrl,
    };
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

  private assertCanInvite(row: CompanyEmployee): void {
    if (row.status === 'active') {
      throw new BadRequestException('Colaborador já está ativo.');
    }
    if (row.status === 'inactive') {
      throw new BadRequestException('Reative o colaborador antes de enviar convite.');
    }
    if (!row.user?.email) {
      throw new BadRequestException('Colaborador sem e-mail cadastrado.');
    }
  }

  private async ensureInviteToken(
    company: Company,
    employee: CompanyEmployee,
  ): Promise<{ token: string; inviteUrl: string }> {
    const email = employee.user!.email.toLowerCase().trim();

    const existing = await this.invites.findOne({
      where: { employeeId: employee.id, acceptedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.expiresAt.getTime() > Date.now()) {
      return {
        token: existing.token,
        inviteUrl: this.mail.buildInviteUrl(existing.token),
      };
    }

    await this.invites.delete({ employeeId: employee.id });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_DAYS);

    await this.invites.save(
      this.invites.create({
        token,
        companyId: company.id,
        email,
        employeeId: employee.id,
        expiresAt,
        acceptedAt: null,
      }),
    );

    return { token, inviteUrl: this.mail.buildInviteUrl(token) };
  }

  private async markInviteSent(employee: CompanyEmployee): Promise<void> {
    employee.status = 'invited';
    employee.invitedAt = new Date();
    await this.employees.save(employee);
  }

  async getInviteLink(company: Company, employeeId: string): Promise<{ inviteUrl: string }> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanInvite(row);
    const { inviteUrl } = await this.ensureInviteToken(company, row);
    return { inviteUrl };
  }

  async sendInviteEmail(company: Company, employeeId: string): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanInvite(row);
    const { token, inviteUrl } = await this.ensureInviteToken(company, row);

    await this.mail.sendEmployeeInvite({
      to: row.user.email,
      employeeName: row.user.name,
      companyName: company.tradeName || company.legalName,
      token,
    });

    await this.markInviteSent(row);
    return this.toDto(row, inviteUrl);
  }

  async sendInviteSms(company: Company, employeeId: string): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(company.id, employeeId);
    this.assertCanInvite(row);

    const phone = row.user?.mobilePhone;
    if (!phone || !isValidMobilePhone(phone)) {
      throw new BadRequestException('Colaborador sem celular válido cadastrado.');
    }

    const { inviteUrl } = await this.ensureInviteToken(company, row);

    await this.sms.sendEmployeeInvite({
      to: phone,
      employeeName: row.user.name,
      companyName: company.tradeName || company.legalName,
      inviteUrl,
    });

    await this.markInviteSent(row);
    return this.toDto(row, inviteUrl);
  }

  async updateEmployeeStatus(
    companyId: string,
    employeeId: string,
    status: CompanyEmployeeStatus,
  ): Promise<EmployeeDto> {
    const row = await this.getEmployeeOrThrow(companyId, employeeId);
    if (status === 'active' && !row.user?.passwordHash) {
      throw new BadRequestException('Colaborador ainda não ativou o convite.');
    }
    row.status = status;
    if (status === 'active' && !row.activatedAt) row.activatedAt = new Date();
    const saved = await this.employees.save(row);
    return this.toDto(saved);
  }

  async resendInvite(company: Company, employeeId: string): Promise<EmployeeDto> {
    return this.sendInviteEmail(company, employeeId);
  }

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

    const user = invite.employee.user;
    const suggestedName = user?.name?.trim() ?? '';
    const suggestedCpf = user?.cpf ? formatCpf(user.cpf) : '';
    const suggestedMobilePhone = user?.mobilePhone ? formatMobilePhone(user.mobilePhone) : '';

    return {
      email: invite.email,
      companyName: invite.company.tradeName || invite.company.legalName,
      expiresAt: invite.expiresAt.toISOString(),
      suggestions: {
        name: suggestedName || undefined,
        cpf: suggestedCpf || undefined,
        mobilePhone: suggestedMobilePhone || undefined,
      },
    };
  }

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

    const cpf = normalizeCpf(input.cpf);
    if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido.');
    if (!input.password || input.password.length < 6) {
      throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
    }

    const user = invite.employee.user;
    if (input.name?.trim()) user.name = input.name.trim();
    user.cpf = cpf;
    user.passwordHash = await bcrypt.hash(input.password, 10);
    const roles = new Set([...(user.roles ?? []), UserRole.MEMBER]);
    user.roles = [...roles];
    await this.users.save(user);

    invite.employee.status = 'active';
    invite.employee.activatedAt = new Date();
    await this.employees.save(invite.employee);

    invite.acceptedAt = new Date();
    await this.invites.save(invite);

    return {
      ok: true,
      message: 'Conta ativada. Você já pode usar o app ACAF Connect.',
    };
  }
}
