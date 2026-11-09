import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthOtpPurpose } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateCompaniesService } from '../corporate/corporate-companies.service';
import { SmsService } from '../sms/sms.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

const OTP_REQUEST_MESSAGE =
  'Se o número estiver cadastrado, você receberá um código no celular em instantes.';

@Injectable()
export class CorporateAuthService {
  constructor(
    private readonly users: UsersService,
    private readonly access: CorporateAccessService,
    private readonly companies: CorporateCompaniesService,
    private readonly jwt: JwtService,
    private readonly otp: AuthOtpService,
    private readonly sms: SmsService,
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

    return this.issueCorporateSession(user);
  }

  async requestOtp(mobilePhone: string, purpose: AuthOtpPurpose) {
    const normalized = this.otp.normalizePhone(mobilePhone);
    const user = await this.users.findByMobilePhone(normalized);

    if (user) {
      try {
        await this.assertCorporateLoginEligible(user.id);
      } catch {
        return { ok: true, message: OTP_REQUEST_MESSAGE };
      }

      const { code } = await this.otp.createOtp({
        mobilePhone: normalized,
        purpose,
        userId: user.id,
      });

      await this.sms.sendCorporateAuthCode({
        to: normalized,
        code,
        purpose: purpose === AuthOtpPurpose.PASSWORD_RESET ? 'password_reset' : 'login',
      });
    }

    return { ok: true, message: OTP_REQUEST_MESSAGE };
  }

  async loginWithOtp(mobilePhone: string, code: string) {
    const normalized = this.otp.normalizePhone(mobilePhone);
    const { userId } = await this.otp.verifyOtp({
      mobilePhone: normalized,
      purpose: AuthOtpPurpose.LOGIN,
      code,
    });

    if (!userId) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    return this.issueCorporateSession(user);
  }

  async resetPasswordWithOtp(mobilePhone: string, code: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
    }

    const normalized = this.otp.normalizePhone(mobilePhone);
    const { userId } = await this.otp.verifyOtp({
      mobilePhone: normalized,
      purpose: AuthOtpPurpose.PASSWORD_RESET,
      code,
    });

    if (!userId) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    await this.assertCorporateLoginEligible(userId);
    await this.users.resetPasswordById(userId, newPassword);

    return {
      ok: true,
      message: 'Senha alterada com sucesso. Faça login com a nova senha.',
    };
  }

  private async assertCorporateLoginEligible(userId: string): Promise<string[]> {
    const companyIds = await this.access.listActiveCompanyIdsForUser(userId);
    if (!companyIds.length) {
      const pending = await this.access.listCompanyIdsForUser(userId);
      if (pending.length) {
        throw new UnauthorizedException(
          'Empresa aguardando aprovação. Entre em contato conosco.',
        );
      }
      throw new UnauthorizedException('Usuário sem acesso a nenhuma empresa.');
    }
    return companyIds;
  }

  private async issueCorporateSession(user: User) {
    const companyIds = await this.assertCorporateLoginEligible(user.id);

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
      company: company ? this.companies.toCompanyDto(company) : null,
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
