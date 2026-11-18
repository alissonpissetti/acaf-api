import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  findConnectMemberByUserId,
  getConnectMemberProfile,
  reconcileConnectMemberForPlatformUser,
  toConnectMemberProfile,
} from '../partner/connectMember';
import { loadStore, updateStore } from '../partner/store';
import { normalizeCpf } from '../users/person.utils';
import { User, UserRole, userHasRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthOtpPurpose } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateEmployeesService } from '../corporate/corporate-employees.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';

const PASSWORD_RESET_SMS_MSG =
  'Se o celular estiver cadastrado em uma conta Movly, você receberá um código por SMS em instantes.';
const PASSWORD_RESET_EMAIL_MSG =
  'Se o e-mail estiver cadastrado em uma conta Movly, você receberá um código por e-mail em instantes.';

@Injectable()
export class MemberAuthService {
  private readonly logger = new Logger(MemberAuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly corporateAccess: CorporateAccessService,
    private readonly corporateEmployees: CorporateEmployeesService,
    private readonly otp: AuthOtpService,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async signup(body: {
    name: string;
    email: string;
    password: string;
    cpf?: string;
    mobilePhone?: string;
    enrollmentCode?: string;
  }) {
    await this.assertCorporateEnrollmentActivation({
      enrollmentCode: body.enrollmentCode,
      cpfDigits: normalizeCpf(body.cpf ?? ''),
      cpfRequiredMessage:
        'Informe o CPF validado na ativação corporativa para criar sua conta.',
    });

    const name = body.name?.trim() ?? '';
    if (!name) {
      throw new BadRequestException('Informe seu nome completo.');
    }
    this.users.assertFullName(name);

    const email = body.email?.trim().toLowerCase() ?? '';
    if (!email) {
      throw new BadRequestException('Informe seu e-mail.');
    }

    const password = body.password ?? '';
    if (password.length < 6) {
      throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (userHasRole(existing, UserRole.MEMBER) && !existing.passwordHash) {
        await this.users.resetPasswordById(existing.id, password);
        const activated = await this.users.findById(existing.id);
        if (activated) {
          await this.finalizeCorporateEnrollmentForUser(body.enrollmentCode, activated);
          await this.syncConnectProfileForUser(activated);
          await this.corporateEmployees.reconcilePendingEmployeesForPlatformUser(activated);
        }
        return this.issueMemberSession(activated ?? existing);
      }
      throw new ConflictException('E-mail já cadastrado. Faça login ou use outro e-mail.');
    }

    const created = await this.users.create({
      name,
      email,
      password,
      cpf: body.cpf,
      mobilePhone: body.mobilePhone,
      roles: [UserRole.MEMBER],
    });

    const user = await this.users.findById(created.id);
    if (!user) {
      throw new BadRequestException('Falha ao criar conta.');
    }

    await this.finalizeCorporateEnrollmentForUser(body.enrollmentCode, user);
    await this.syncConnectProfileForUser(user);
    await this.corporateEmployees.reconcilePendingEmployeesForPlatformUser(user);
    return this.issueMemberSession(user);
  }

  private async finalizeCorporateEnrollmentForUser(
    enrollmentCode: string | undefined,
    user: User,
  ): Promise<void> {
    const code = enrollmentCode?.trim() ?? '';
    const cpfDigits = user.cpf ? normalizeCpf(user.cpf) : '';
    if (!code || !cpfDigits) return;

    const company = await this.corporateAccess.findActiveByEnrollmentCode(code);
    if (!company) return;

    await this.corporateEmployees.completeAppEnrollmentActivation(company.id, cpfDigits, {
      platformUserId: user.id,
    });
  }

  private async assertCorporateEnrollmentActivation(input: {
    enrollmentCode?: string;
    cpfDigits: string;
    cpfRequiredMessage: string;
    platformUserId?: string;
  }) {
    const code = input.enrollmentCode?.trim() ?? '';
    if (!code) return;

    const cpfDigits = input.cpfDigits;
    if (!cpfDigits) {
      throw new BadRequestException(input.cpfRequiredMessage);
    }

    const company = await this.corporateAccess.findActiveByEnrollmentCode(code);
    if (!company) {
      throw new BadRequestException(
        'Código de adesão corporativo inválido. Refaça a ativação com o RH.',
      );
    }

    await this.corporateEmployees.completeAppEnrollmentActivation(company.id, cpfDigits, {
      platformUserId: input.platformUserId,
    });
  }

  private isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private logDevOtp(channel: string, destination: string, code: string): void {
    if (this.isProduction()) return;
    this.logger.warn(
      `[dev] OTP recuperação membro (${channel}) → ${destination} · código ${code}`,
    );
  }

  /**
   * App Movly (associado): papel Cliente (member) ou titular com cadastro connect no store.
   */
  private async resolveUserForMemberApp(
    login: string,
  ): Promise<{ user: User | null; ineligibleHint?: string }> {
    const user = await this.users.findByLogin(login.trim());
    if (!user?.active) {
      return { user: null };
    }
    if (userHasRole(user, UserRole.MEMBER)) {
      return { user };
    }

    const store = loadStore();
    const emailKey = user.email.trim().toLowerCase();
    const hasConnectProfile =
      Boolean(findConnectMemberByUserId(store, user.id)) ||
      (store.connectMembers ?? []).some(
        (m) => m.holderEmail?.trim().toLowerCase() === emailKey,
      );

    if (hasConnectProfile) {
      await this.users.ensureMemberUser({
        name: user.name,
        email: user.email,
        cpf: user.cpf ?? undefined,
      });
      const refreshed = await this.users.findById(user.id);
      if (refreshed?.active && userHasRole(refreshed, UserRole.MEMBER)) {
        return { user: refreshed };
      }
    }

    if (userHasRole(user, UserRole.PARTNER) && !userHasRole(user, UserRole.MEMBER)) {
      return {
        user: null,
        ineligibleHint:
          'Esta conta é de parceiro (portal da academia). Para o app Movly, peça no admin para incluir o papel Cliente neste usuário — ou crie uma conta de associado.',
      };
    }

    return {
      user: null,
      ineligibleHint:
        'Conta sem perfil de associado no app. Confira o e-mail ou conclua o cadastro Movly.',
    };
  }

  async requestPasswordReset(login: string, channel: 'sms' | 'email') {
    const trimmed = login.trim();
    if (!trimmed) {
      throw new BadRequestException('Informe e-mail, CPF ou celular cadastrado.');
    }
    if (channel !== 'sms' && channel !== 'email') {
      throw new BadRequestException('Canal inválido. Use sms ou email.');
    }

    this.logger.log(
      `password-reset/request canal=${channel} login=${trimmed.includes('@') ? trimmed.toLowerCase() : '***'}`,
    );

    const { user, ineligibleHint } = await this.resolveUserForMemberApp(trimmed);
    const generic =
      channel === 'sms' ? { ok: true, message: PASSWORD_RESET_SMS_MSG } : { ok: true, message: PASSWORD_RESET_EMAIL_MSG };

    if (!user) {
      const loginDigits = normalizeMobilePhone(trimmed);
      const smsNotFound =
        channel === 'sms' && isValidMobilePhone(loginDigits)
          ? 'Nenhuma conta com este celular. Use o e-mail do cadastro ou peça para incluir o celular no admin (Usuários).'
          : undefined;
      return {
        ...generic,
        delivered: false,
        hint: ineligibleHint ?? smsNotFound,
      };
    }

    if (channel === 'sms') {
      const loginDigits = normalizeMobilePhone(trimmed);
      const profileDigits = user.mobilePhone ? normalizeMobilePhone(user.mobilePhone) : '';
      const raw =
        user.mobilePhone && isValidMobilePhone(profileDigits)
          ? user.mobilePhone
          : isValidMobilePhone(loginDigits)
            ? loginDigits
            : null;
      if (!raw) {
        return {
          ok: true,
          delivered: false,
          message: PASSWORD_RESET_SMS_MSG,
          hint: 'Não encontramos celular válido neste cadastro. Tente recuperação por e-mail ou atualize o celular com o suporte.',
        };
      }
      if (
        profileDigits &&
        isValidMobilePhone(loginDigits) &&
        loginDigits !== profileDigits
      ) {
        return {
          ok: true,
          delivered: false,
          message: PASSWORD_RESET_SMS_MSG,
          hint: `O celular informado não bate com o cadastro de ${user.email}. Use o número desta conta ou recupere por e-mail.`,
        };
      }
      const normalized = this.otp.normalizePhone(raw);
      const { code } = await this.otp.createOtp({
        mobilePhone: normalized,
        purpose: AuthOtpPurpose.PASSWORD_RESET,
        userId: user.id,
      });
      const smsResult = await this.sms.sendMemberAuthCode({ to: normalized, code, purpose: 'password_reset' });
      this.logDevOtp('sms', normalized, code);
      if (!smsResult.sent) {
        throw new BadRequestException(
          smsResult.reason ??
            'Não foi possível enviar o SMS agora. Verifique Comtele na API ou use recuperação por e-mail.',
        );
      }
      this.logger.log(`OTP recuperação (SMS) enviado userId=${user.id}`);
      return { ok: true, message: PASSWORD_RESET_SMS_MSG, delivered: true };
    }

    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return {
        ok: true,
        delivered: false,
        message: PASSWORD_RESET_EMAIL_MSG,
        hint: 'Esta conta não tem e-mail no cadastro. Tente por SMS ou fale com o suporte.',
      };
    }

    const loginEmail = trimmed.includes('@') ? trimmed.toLowerCase() : null;
    if (loginEmail && loginEmail !== email) {
      return {
        ok: true,
        delivered: false,
        message: PASSWORD_RESET_EMAIL_MSG,
        hint: 'O e-mail informado não coincide com o cadastro. Use o e-mail da conta ou tente SMS.',
      };
    }

    const { code } = await this.otp.createEmailOtp({
      email,
      purpose: AuthOtpPurpose.PASSWORD_RESET,
      userId: user.id,
    });
    const mailResult = await this.mail.sendMemberPasswordResetCode({ to: email, code });
    this.logDevOtp('email', email, code);
    if (!mailResult.sent) {
      throw new BadRequestException(
        mailResult.reason ??
          'Não foi possível enviar o e-mail agora. Configure MAIL_PROVIDER/SMTP na API ou tente SMS.',
      );
    }
    this.logger.log(`OTP recuperação (e-mail) enviado userId=${user.id} → ${email}`);
    return { ok: true, message: PASSWORD_RESET_EMAIL_MSG, delivered: true };
  }

  async resetPasswordWithOtp(input: {
    login: string;
    channel: 'sms' | 'email';
    code: string;
    newPassword: string;
  }) {
    const newPassword = input.newPassword ?? '';
    if (newPassword.length < 6) {
      throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
    }

    const trimmed = input.login.trim();
    if (!trimmed) {
      throw new BadRequestException('Informe e-mail, CPF ou celular cadastrado.');
    }

    const { user } = await this.resolveUserForMemberApp(trimmed);
    if (!user) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    let userId: string | null = null;
    if (input.channel === 'sms') {
      const raw =
        user.mobilePhone && isValidMobilePhone(normalizeMobilePhone(user.mobilePhone))
          ? user.mobilePhone
          : isValidMobilePhone(normalizeMobilePhone(trimmed))
            ? trimmed
            : null;
      if (!raw) {
        throw new BadRequestException('Esta conta não tem celular para validação por SMS.');
      }
      const normalized = this.otp.normalizePhone(raw);
      const verified = await this.otp.verifyOtp({
        mobilePhone: normalized,
        purpose: AuthOtpPurpose.PASSWORD_RESET,
        code: input.code,
      });
      userId = verified.userId;
    } else {
      const email = user.email?.trim().toLowerCase();
      if (!email) {
        throw new BadRequestException('Esta conta não tem e-mail para validação.');
      }
      const verified = await this.otp.verifyEmailOtp({
        email,
        purpose: AuthOtpPurpose.PASSWORD_RESET,
        code: input.code,
      });
      userId = verified.userId;
    }

    if (!userId || userId !== user.id) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    await this.users.resetPasswordById(user.id, newPassword);
    return { ok: true, message: 'Senha alterada com sucesso. Entre com a nova senha.' };
  }

  async login(login: string, password: string, enrollmentCode?: string) {
    const trimmed = login.trim();
    if (!trimmed || !password) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const { user } = await this.resolveUserForMemberApp(trimmed);
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const valid = await this.users.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    await this.assertCorporateEnrollmentActivation({
      enrollmentCode,
      cpfDigits: user.cpf ? normalizeCpf(user.cpf) : '',
      cpfRequiredMessage:
        'Sua conta não tem CPF cadastrado. Crie uma conta com o CPF validado na adesão ou atualize seus dados.',
      platformUserId: user.id,
    });

    await this.syncConnectProfileForUser(user);
    await this.corporateEmployees.reconcilePendingEmployeesForPlatformUser(user);
    return this.issueMemberSession(user);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active || !userHasRole(user, UserRole.MEMBER)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const safe = this.users.toSafeUser(user);
    await this.syncConnectProfileForUser(user);
    await this.corporateEmployees.reconcilePendingEmployeesForPlatformUser(user);

    const connectProfile = await this.resolveConnectProfileForUser(user);

    return {
      user: this.memberUserPayload(safe),
      connectProfile,
    };
  }

  uploadAvatar(userId: string, file: Express.Multer.File) {
    return this.users.uploadAvatar(userId, file, userId);
  }

  removeAvatar(userId: string) {
    return this.users.removeAvatar(userId, userId);
  }

  private memberUserPayload(safe: ReturnType<UsersService['toSafeUser']>) {
    return {
      id: safe.id,
      name: safe.name,
      email: safe.email,
      cpf: safe.cpf,
      mobilePhone: safe.mobilePhone,
      roles: safe.roles,
      roleLabels: safe.roleLabels,
      avatarUrl: safe.avatarUrl,
      avatarColor: safe.avatarColor,
    };
  }

  /** Vincula assinatura no store JSON ao userId (checkout pré-login ou troca de dispositivo). */
  async syncConnectProfileForUser(user: User) {
    const store = loadStore();
    const cpf = user.cpf ? normalizeCpf(user.cpf) : '';

    let member =
      findConnectMemberByUserId(store, user.id) ??
      (cpf
        ? store.connectMembers?.find((m) => m.holderCpf && normalizeCpf(m.holderCpf) === cpf)
        : undefined) ??
      store.connectMembers?.find((m) => m.holderEmail?.trim().toLowerCase() === user.email.trim().toLowerCase());

    if (!member) {
      const byName = getConnectMemberProfile(user.name);
      if (byName) {
        member = store.connectMembers?.find((m) => m.holderKey === byName.holderKey);
      }
    }

    if (!member) {
      return null;
    }

    updateStore((s) => {
      reconcileConnectMemberForPlatformUser(s, {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
      });
    });

    const fresh = loadStore();
    const linked = findConnectMemberByUserId(fresh, user.id) ?? member;
    return toConnectMemberProfile(linked);
  }

  private async resolveConnectProfileForUser(user: User) {
    await this.syncConnectProfileForUser(user);
    const store = loadStore();
    const member = findConnectMemberByUserId(store, user.id);
    return member ? toConnectMemberProfile(member) : null;
  }

  private async issueMemberSession(user: User) {
    const safe = this.users.toSafeUser(user);
    const payload = {
      sub: user.id,
      email: user.email,
      aud: 'member',
    };
    const accessToken = await this.jwt.signAsync(payload);
    const connectProfile = await this.resolveConnectProfileForUser(user);

    return {
      accessToken,
      user: this.memberUserPayload(safe),
      connectProfile,
    };
  }
}