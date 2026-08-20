import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';
import { AuthOtp, AuthOtpPurpose } from './auth-otp.entity';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class AuthOtpService {
  constructor(
    @InjectRepository(AuthOtp)
    private readonly otps: Repository<AuthOtp>,
  ) {}

  normalizePhone(raw: string): string {
    const digits = normalizeMobilePhone(raw);
    if (!isValidMobilePhone(digits)) {
      throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
    }
    return digits;
  }

  async createOtp(input: {
    mobilePhone: string;
    purpose: AuthOtpPurpose;
    userId?: string | null;
  }): Promise<{ code: string }> {
    const mobilePhone = this.normalizePhone(input.mobilePhone);

    const recent = await this.otps.findOne({
      where: {
        mobilePhone,
        purpose: input.purpose,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (recent && Date.now() - recent.createdAt.getTime() < OTP_COOLDOWN_MS) {
      throw new BadRequestException('Aguarde um minuto antes de solicitar um novo código.');
    }

    await this.otps.update(
      {
        mobilePhone,
        purpose: input.purpose,
        consumedAt: IsNull(),
      },
      { consumedAt: new Date() },
    );

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otps.save(
      this.otps.create({
        mobilePhone,
        purpose: input.purpose,
        codeHash,
        userId: input.userId ?? null,
        expiresAt,
      }),
    );

    return { code };
  }

  async verifyOtp(input: {
    mobilePhone: string;
    purpose: AuthOtpPurpose;
    code: string;
  }): Promise<{ userId: string | null }> {
    const mobilePhone = this.normalizePhone(input.mobilePhone);
    const trimmedCode = String(input.code ?? '').trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      throw new BadRequestException('Informe o código de 6 dígitos recebido por SMS.');
    }

    const row = await this.otps.findOne({
      where: {
        mobilePhone,
        purpose: input.purpose,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (!row) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const valid = await bcrypt.compare(trimmedCode, row.codeHash);
    if (!valid) {
      row.attempts += 1;
      await this.otps.save(row);
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    row.consumedAt = new Date();
    await this.otps.save(row);

    return { userId: row.userId };
  }
}
