import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthOtpPurpose } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { SmsService } from '../sms/sms.service';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { UsersService } from '../users/users.service';

type PartnerSessionUser = {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  active: boolean;
  roles: string[];
  roleLabels: string[];
};

const OTP_REQUEST_MESSAGE =
  'Se o número estiver cadastrado, você receberá um código no celular em instantes.';

@Injectable()
export class PartnerAuthService {
  constructor(
    private readonly users: UsersService,
    private readonly partnerAccess: PartnerAccessService,
    private readonly jwt: JwtService,
    private readonly otp: AuthOtpService,
    private readonly sms: SmsService,
  ) {}

  private async signSession(user: PartnerSessionUser, unitIds: string[]) {
    const payload = {
      sub: user.id,
      email: user.email,
      aud: 'partner',
    };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user, unitIds };
  }

  /** Login programático pós-onboarding (mesmo payload do /login). */
  async issueTokensForUserId(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    if (!unitIds.length) {
      throw new UnauthorizedException('Usuário sem acesso a nenhuma unidade.');
    }

    const safe = this.users.toSafeUser(user);
    return this.signSession(
      {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    );
  }

  async requestLoginOtp(mobilePhone: string) {
    const normalized = this.otp.normalizePhone(mobilePhone);
    const user = await this.users.findByMobilePhone(normalized);

    if (user?.active) {
      const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
      if (unitIds.length > 0) {
        const { code } = await this.otp.createOtp({
          mobilePhone: normalized,
          purpose: AuthOtpPurpose.PARTNER_LOGIN,
          userId: user.id,
        });
        await this.sms.sendPartnerAuthCode({
          to: normalized,
          code,
          purpose: 'login',
        });
      }
    }

    return { ok: true, message: OTP_REQUEST_MESSAGE };
  }

  async loginWithOtp(mobilePhone: string, code: string) {
    const normalized = this.otp.normalizePhone(mobilePhone);
    const { userId } = await this.otp.verifyOtp({
      mobilePhone: normalized,
      purpose: AuthOtpPurpose.PARTNER_LOGIN,
      code,
    });

    if (!userId) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    if (!unitIds.length) {
      throw new UnauthorizedException('Usuário sem acesso a nenhuma unidade.');
    }

    const safe = this.users.toSafeUser(user);
    return this.signSession(
      {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    );
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

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    if (!unitIds.length) {
      throw new UnauthorizedException('Usuário sem acesso a nenhuma unidade.');
    }

    const safe = this.users.toSafeUser(user);
    return this.signSession(
      {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    );
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    const safe = this.users.toSafeUser(user);
    return {
      user: {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    };
  }
}
