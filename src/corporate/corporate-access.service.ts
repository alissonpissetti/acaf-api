import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { CompanyAccess } from './company-access.entity';
import { Company, type CompanyStatus } from './company.entity';
import { normalizeEnrollmentCode } from './enrollment-code';

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

  async listCompanies(status?: CompanyStatus): Promise<Company[]> {
    if (status) return this.companies.find({ where: { status }, order: { createdAt: 'DESC' } });
    return this.companies.find({ order: { createdAt: 'DESC' } });
  }

  async updateCompanyStatus(id: string, status: CompanyStatus): Promise<Company> {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    company.status = status;
    return this.companies.save(company);
  }

  async findActiveByEnrollmentCode(code: string): Promise<Company | null> {
    const normalized = normalizeEnrollmentCode(code);
    if (!normalized) return null;
    return this.companies.findOne({
      where: { enrollmentCode: normalized, status: 'active' },
    });
  }
}
