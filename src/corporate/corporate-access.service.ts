import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { CompanyAccess } from './company-access.entity';
import { Company, type CompanyStatus } from './company.entity';
import { generateEnrollmentCode, enrollmentCodeLookupKeys } from './enrollment-code';

export type LinkedCorporateUser = {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  active: boolean;
  accessId: string;
  linkedAt: Date;
};

@Injectable()
export class CorporateAccessService {
  constructor(
    @InjectRepository(CompanyAccess)
    private readonly access: Repository<CompanyAccess>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    private readonly users: UsersService,
  ) {}

  async listCompanyIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.access.find({ where: { userId }, select: ['companyId'] });
    return rows.map((r) => r.companyId);
  }

  async listActiveCompanyIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.access.find({
      where: { userId },
      relations: ['company'],
    });
    return rows.filter((r) => r.company?.status === 'active').map((r) => r.companyId);
  }

  async linkUserToCompany(companyId: string, userId: string): Promise<LinkedCorporateUser> {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const user = await this.users.findById(userId);
    if (!user?.active) throw new NotFoundException('Usuário não encontrado.');

    let row = await this.access.findOne({ where: { companyId, userId } });
    if (!row) {
      row = await this.access.save(this.access.create({ companyId, userId }));
    }

    const safe = this.users.toSafeUser(user);
    return {
      id: safe.id,
      name: safe.name,
      email: safe.email,
      cpf: safe.cpf,
      active: safe.active,
      accessId: row.id,
      linkedAt: row.createdAt,
    };
  }

  async unlinkUserFromCompany(companyId: string, userId: string): Promise<void> {
    const row = await this.access.findOne({ where: { companyId, userId } });
    if (!row) throw new NotFoundException('Usuário não vinculado a esta empresa.');
    await this.access.remove(row);
  }

  async listCompanyManagers(companyId: string): Promise<LinkedCorporateUser[]> {
    const rows = await this.access.find({
      where: { companyId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return rows
      .filter((r) => r.user?.active)
      .map((r) => {
        const safe = this.users.toSafeUser(r.user);
        return {
          id: safe.id,
          name: safe.name,
          email: safe.email,
          cpf: safe.cpf,
          active: safe.active,
          accessId: r.id,
          linkedAt: r.createdAt,
        };
      });
  }

  async getCompanyForUser(userId: string, companyId: string): Promise<Company | null> {
    const row = await this.access.findOne({
      where: { userId, companyId },
      relations: ['company'],
    });
    return row?.company ?? null;
  }

  async assertCompanyAccess(userId: string, companyId: string): Promise<Company> {
    const company = await this.getCompanyForUser(userId, companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada ou sem acesso.');
    return company;
  }

  async findCompanyById(id: string): Promise<Company | null> {
    return this.companies.findOne({ where: { id } });
  }

  async deleteCompany(id: string): Promise<void> {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    await this.access.delete({ companyId: id });
    await this.companies.remove(company);
  }

  async listCompanies(status?: CompanyStatus): Promise<Company[]> {
    if (status) return this.companies.find({ where: { status }, order: { createdAt: 'DESC' } });
    return this.companies.find({ order: { createdAt: 'DESC' } });
  }

  async updateCompanyStatus(
    id: string,
    status: CompanyStatus,
    actingUserId?: string,
  ): Promise<Company> {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    company.status = status;
    let saved = await this.companies.save(company);
    if (saved.status === 'active') {
      await this.ensureEnrollmentCode(saved);
      saved = (await this.companies.findOne({ where: { id } })) ?? saved;
      if (!saved.commercialOwnerUserId && actingUserId) {
        saved.commercialOwnerUserId = actingUserId;
        saved = await this.companies.save(saved);
      }
    }
    return saved;
  }

  async ensureEnrollmentCode(company: Company): Promise<string> {
    if (company.enrollmentCode) return company.enrollmentCode;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = generateEnrollmentCode(
        company.tradeName,
        attempt,
        company.legalName,
      );
      const clash = await this.companies.findOne({ where: { enrollmentCode: candidate } });
      if (clash) continue;
      company.enrollmentCode = candidate;
      await this.companies.save(company);
      return candidate;
    }

    throw new Error('Não foi possível gerar código de adesão para a empresa.');
  }

  async findActiveByEnrollmentCode(code: string): Promise<Company | null> {
    const keys = enrollmentCodeLookupKeys(code);
    if (!keys.length) return null;

    for (const key of keys) {
      const company = await this.companies.findOne({
        where: { enrollmentCode: key, status: 'active' },
      });
      if (company) return company;
    }

    return null;
  }
}
