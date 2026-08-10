import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendSmsResult = {
  sent: boolean;
};

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendEmployeeInvite(input: {
    to: string;
    employeeName: string;
    companyName: string;
    inviteUrl: string;
  }): Promise<SendSmsResult> {
    const message = [
      `Olá${input.employeeName ? `, ${input.employeeName}` : ''}!`,
      `${input.companyName} convidou você para o ACAF Connect.`,
      `Ative sua conta: ${input.inviteUrl}`,
    ].join(' ');

    const provider = this.config.get<string>('SMS_PROVIDER');
    if (!provider) {
      this.logger.log(`[dev] SMS para ${input.to}: ${message}`);
      return { sent: false };
    }

    this.logger.warn(
      `SMS_PROVIDER configurado mas integração não implementada. Mensagem dev: ${message}`,
    );
    return { sent: false };
  }
}
