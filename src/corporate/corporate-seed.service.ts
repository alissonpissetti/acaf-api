import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { loadStore } from '../partner/store';
import type { GymStudent } from '../partner/types';
import { CompanyAccess } from './company-access.entity';
import { CompanyEmployee } from './company-employee.entity';
import { Company } from './company.entity';
import {
  DEMO_CORPORATE_COMPANIES,
  demoCompanyBySlug,
} from './demo-corporate-companies';
import { CorporateInvoicesService } from './corporate-invoices.service';
import { currentMonthKey } from './corporate-domain';

@Injectable()
export class CorporateSeedService implements OnModuleInit {
  private readonly logger = new Logger(CorporateSeedService.name);

  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyAccess)
    private readonly access: Repository<CompanyAccess>,
    @InjectRepository(CompanyEmployee)
    private readonly employees: Repository<CompanyEmployee>,
    private readonly users: UsersService,
    private readonly invoices: CorporateInvoicesService,
  ) {}

  async onModuleInit() {
    const companyBySlug = await this.ensureDemoCompanies();
    await this.ensureDemoManager(companyBySlug.get('corp_tagsa')!);
    await this.syncEmployeesFromStore(companyBySlug);
    await this.ensureDemoPortalEmployees(companyBySlug.get('corp_tagsa')!);
  }

  private async ensureDemoCompanies(): Promise<Map<string, Company>> {
    const map = new Map<string, Company>();

    for (const def of DEMO_CORPORATE_COMPANIES) {
      let row = await this.companies.findOne({ where: { cnpj: def.cnpj } });
      if (!row) {
        row = await this.companies.save(
          this.companies.create({
            legalName: def.legalName,
            tradeName: def.tradeName,
            cnpj: def.cnpj,
            email: def.email,
            phone: def.phone,
            status: def.status,
          }),
        );
        this.logger.log(`Empresa demo criada: ${row.tradeName}`);
      }
      map.set(def.slug, row);
    }

    return map;
  }

  private async ensureDemoManager(company: Company) {
    const existingAccess = await this.access.findOne({
      where: { companyId: company.id },
    });
    if (existingAccess) return;

    const manager = await this.users.create({
      name: 'Gestor Demo Corp',
      email: 'gestor@empresademo.com.br',
      password: 'demo123',
      cpf: '39053344705',
      mobilePhone: '11999990001',
      roles: [UserRole.CORPORATE],
    });

    await this.access.save(
      this.access.create({ companyId: company.id, userId: manager.id }),
    );

    this.logger.log(
      `Gestor corporativo demo: gestor@empresademo.com.br / demo123 (${company.tradeName})`,
    );
  }

  /** Colaboradores extras para testar o portal corporativo (convite, inativo). */
  private async ensureDemoPortalEmployees(company: Company) {
    const portalDemo = [
      {
        name: 'Colaborador Ativo Demo',
        email: 'colaborador.ativo@empresademo.com.br',
        mobilePhone: '11999990002',
        status: 'active' as const,
      },
      {
        name: 'Colaborador Cadastrado Demo',
        email: 'colaborador.pendente@empresademo.com.br',
        mobilePhone: '11999990003',
        status: 'pending' as const,
      },
      {
        name: 'Colaborador Convidado Demo',
        email: 'colaborador.convite@empresademo.com.br',
        mobilePhone: '11999990004',
        status: 'invited' as const,
      },
      {
        name: 'Colaborador Inativo Demo',
        email: 'colaborador.inativo@empresademo.com.br',
        mobilePhone: '11999990005',
        status: 'inactive' as const,
      },
    ];

    for (const row of portalDemo) {
      const userId = await this.users.ensureMemberUser({
        name: row.name,
        email: row.email,
      });
      if (row.mobilePhone) {
        await this.users.update(userId, { mobilePhone: row.mobilePhone });
      }
      await this.ensureEmployee(company.id, userId, row.status);
    }
  }

  private async syncEmployeesFromStore(companyBySlug: Map<string, Company>) {
    let students: GymStudent[];
    try {
      students = loadStore().students;
    } catch {
      return;
    }

    let linked = 0;
    for (const student of students) {
      if (!student.companyName && !student.companySlug) continue;

      const slug = student.companySlug;
      const def = slug ? demoCompanyBySlug(slug) : undefined;
      const company =
        (slug ? companyBySlug.get(slug) : undefined) ??
        (def ? companyBySlug.get(def.slug) : undefined) ??
        companyBySlug.get('corp_tagsa');

      if (!company) continue;

      const userId = await this.users.ensureMemberUser({
        name: student.name,
        email: student.email,
        cpf: student.cpf,
      });

      const created = await this.ensureEmployee(company.id, userId, 'active');
      if (created) linked += 1;
    }

    for (const company of companyBySlug.values()) {
      await this.invoices.ensureInvoiceForCompany(company, currentMonthKey());
    }

    if (linked > 0) {
      this.logger.log(`${linked} colaborador(es) demo vinculado(s) a empresas corporativas.`);
    }
  }

  private async ensureEmployee(
    companyId: string,
    userId: string,
    status: 'active' | 'invited' | 'inactive' | 'pending',
  ): Promise<boolean> {
    const existing = await this.employees.findOne({
      where: { companyId, userId },
    });
    if (existing) {
      if (existing.status !== status && status === 'active') {
        existing.status = 'active';
        existing.activatedAt = existing.activatedAt ?? new Date();
        await this.employees.save(existing);
      }
      return false;
    }

    await this.employees.save(
      this.employees.create({
        companyId,
        userId,
        status,
        invitedAt: status === 'invited' ? new Date() : null,
        activatedAt: status === 'active' ? new Date() : null,
      }),
    );
    return true;
  }
}
