import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  formatCnpj,
  isValidCnpj,
  isValidCpf,
  isValidMobilePhone,
  normalizeCnpj,
  normalizeCpf,
  normalizeMobilePhone,
} from '../users/person.utils';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CompanyAccess } from './company-access.entity';
import { Company } from './company.entity';

@Injectable()
export class CorporateCompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyAccess)
    private readonly access: Repository<CompanyAccess>,
    private readonly users: UsersService,
  ) {}

  async signup(input: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    companyEmail: string;
    phone?: string;
    managerName: string;
    managerEmail: string;
    managerCpf: string;
    managerPhone: string;
    password: string;
  }) {
    const cnpj = normalizeCnpj(input.cnpj);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');

    const existingCnpj = await this.companies.findOne({ where: { cnpj } });
    if (existingCnpj) throw new ConflictException('CNPJ já cadastrado.');

    const cpf = normalizeCpf(input.managerCpf);
    if (!isValidCpf(cpf)) throw new BadRequestException('CPF do gestor inválido.');

    const phone = normalizeMobilePhone(input.managerPhone);
    if (!isValidMobilePhone(phone)) {
      throw new BadRequestException('Informe um celular válido do gestor.');
    }

    const company = await this.companies.save(
      this.companies.create({
        legalName: input.legalName.trim(),
        tradeName: input.tradeName.trim() || input.legalName.trim(),
        cnpj,
        email: input.companyEmail.toLowerCase().trim(),
        phone: input.phone ? normalizeMobilePhone(input.phone) || null : null,
        status: 'pending',
      }),
    );

    const manager = await this.users.create({
      name: input.managerName.trim(),
      email: input.managerEmail,
      password: input.password,
      cpf,
      mobilePhone: phone,
      roles: [UserRole.CORPORATE],
    });

    await this.access.save(
      this.access.create({ companyId: company.id, userId: manager.id }),
    );

    return {
      ok: true,
      message:
        'Cadastro recebido. Sua empresa será analisada pela equipe ACAF antes da liberação do acesso.',
      company: {
        id: company.id,
        tradeName: company.tradeName,
        cnpj: company.cnpj ? formatCnpj(company.cnpj) : null,
        status: company.status,
      },
    };
  }

  async createByAdmin(input: {
    legalName: string;
    tradeName?: string;
    cnpj?: string;
    email?: string;
    phone?: string;
    commercialOwnerUserId?: string;
  }) {
    const legalName = String(input.legalName ?? '').trim();
    if (!legalName) throw new BadRequestException('Informe o nome da empresa.');

    const cnpjRaw = input.cnpj ? normalizeCnpj(input.cnpj) : '';
    let cnpj: string | null = null;
    if (cnpjRaw) {
      if (!isValidCnpj(cnpjRaw)) throw new BadRequestException('CNPJ inválido.');
      const existingCnpj = await this.companies.findOne({ where: { cnpj: cnpjRaw } });
      if (existingCnpj) throw new ConflictException('CNPJ já cadastrado.');
      cnpj = cnpjRaw;
    }

    const emailRaw = input.email != null ? String(input.email).trim() : '';
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    const phoneRaw = input.phone ? normalizeMobilePhone(input.phone) : '';
    if (phoneRaw && !isValidMobilePhone(phoneRaw)) {
      throw new BadRequestException('Informe um telefone válido com DDD (11 dígitos).');
    }

    const company = await this.companies.save(
      this.companies.create({
        legalName,
        tradeName: input.tradeName?.trim() || legalName,
        cnpj,
        email,
        phone: phoneRaw || null,
        status: 'pending',
        commercialOwnerUserId: input.commercialOwnerUserId ?? null,
      }),
    );

    return this.toCompanyDto(company, { managers: 0, employees: 0 });
  }

  toCompanyDto(company: Company, extras?: { managers?: number; employees?: number }) {
    return {
      id: company.id,
      legalName: company.legalName,
      tradeName: company.tradeName,
      cnpj: company.cnpj ? formatCnpj(company.cnpj) : null,
      email: company.email,
      phone: company.phone,
      status: company.status,
      enrollmentCode: company.enrollmentCode ?? null,
      commercialOwnerUserId: company.commercialOwnerUserId ?? null,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
      ...extras,
    };
  }
}
