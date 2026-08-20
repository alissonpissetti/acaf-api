import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PermissionsService } from '../access-control/access-control.service';
import { SmsService } from '../sms/sms.service';
import { User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthOtpPurpose } from './auth-otp.entity';
import { AuthOtpService } from './auth-otp.service';

const OTP_REQUEST_MESSAGE =
  'Se o número estiver cadastrado, você receberá um SMS em instantes.';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionsService,
    private readonly otp: AuthOtpService,
    private readonly sms: SmsService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    this.users.assertAdminAccess(user);

    const valid = await this.users.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    return this.issueSession(user);
  }

  async requestOtp(mobilePhone: string, purpose: AuthOtpPurpose) {
    const normalized = this.otp.normalizePhone(mobilePhone);
    const user = await this.users.findByMobilePhone(normalized);

    if (user) {
      try {
        this.users.assertAdminAccess(user);
      } catch {
        return { ok: true, message: OTP_REQUEST_MESSAGE };
      }

      const { code } = await this.otp.createOtp({
        mobilePhone: normalized,
        purpose,
        userId: user.id,
      });

      await this.sms.sendAdminAuthCode({
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
    if (!user) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    this.users.assertAdminAccess(user);
    return this.issueSession(user);
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
    if (!user) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    this.users.assertAdminAccess(user);
    await this.users.resetPasswordById(userId, newPassword);

    return { ok: true, message: 'Senha alterada com sucesso. Faça login com a nova senha.' };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    this.users.assertAdminAccess(user);
    const normalized = await this.users.ensureAvatarColor(user);
    const profile = await this.users.toSafeUserDetailed(normalized);
    const permissionKeys = await this.permissions.getUserPermissionKeys(userId);
    return { ...profile, permissions: permissionKeys };
  }

  updateProfile(userId: string, patch: { avatarColor?: string }) {
    return this.users.updateMyProfile(userId, patch).then(async (profile) => {
      const permissionKeys = await this.permissions.getUserPermissionKeys(userId);
      return { ...profile, permissions: permissionKeys };
    });
  }

  uploadAvatar(userId: string, file: Express.Multer.File) {
    return this.users.uploadAvatar(userId, file, userId);
  }

  removeAvatar(userId: string) {
    return this.users.removeAvatar(userId, userId);
  }

  private async issueSession(user: User) {
    const normalized = await this.users.ensureAvatarColor(user);
    const payload = { sub: normalized.id, email: normalized.email, roles: normalized.roles ?? [UserRole.ADMIN] };
    const accessToken = await this.jwt.signAsync(payload);
    const profile = await this.users.toSafeUserDetailed(normalized);
    const permissionKeys = await this.permissions.getUserPermissionKeys(normalized.id);

    return {
      accessToken,
      user: { ...profile, permissions: permissionKeys },
    };
  }
}
