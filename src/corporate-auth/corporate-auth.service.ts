import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateCompaniesService } from '../corporate/corporate-companies.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class CorporateAuthService {
  constructor(
    private readonly users: UsersService,
    private readonly access: CorporateAccessService,
    private readonly companies: CorporateCompaniesService,
    private readonly jwt: JwtService,
  ) {}

  async signup(body: {
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
    return this.companies.signup(body);
  }

  async login(login: string, password: string) {
    const trimmed = login.trim();
    if (!trimmed || !password) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const user = await this.users.findByLogin(trimmed);
    if (!user?.active) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const valid = await this.users.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const companyIds = await this.access.listActiveCompanyIdsForUser(user.id);
    if (!companyIds.length) {
      const pending = await this.access.listCompanyIdsForUser(user.id);
      if (pending.length) {
        throw new UnauthorizedException(
          'Empresa aguardando aprovação. Entre em contato com a ACAF.',
        );
      }
      throw new UnauthorizedException('Usuário sem acesso a nenhuma empresa.');
    }

    const safe = this.users.toSafeUser(user);
    const payload = {
      sub: user.id,
      email: user.email,
      aud: 'corporate',
      companyId: companyIds[0],
    };
    const accessToken = await this.jwt.signAsync(payload);

    let company = await this.access.findCompanyById(companyIds[0]!);
    if (company?.status === 'active') {
      await this.access.ensureEnrollmentCode(company);
      company = await this.access.findCompanyById(companyIds[0]!);
    }

    return {
      accessToken,
      user: {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      companyIds,
      company: company
        ? this.companies.toCompanyDto(company)
        : null,
    };
  }

  async me(userId: string, companyId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const company = await this.access.getCompanyForUser(userId, companyId);
    if (!company || company.status !== 'active') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    if (!company.enrollmentCode) {
      await this.access.ensureEnrollmentCode(company);
    }

    const companyIds = await this.access.listActiveCompanyIdsForUser(userId);
    const safe = this.users.toSafeUser(user);

    return {
      user: {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      companyIds,
      company: this.companies.toCompanyDto(company),
    };
  }
}
