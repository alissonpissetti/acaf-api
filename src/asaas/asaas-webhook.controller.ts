import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AsaasInboundService } from './asaas-inbound.service';

@ApiTags('Public · Asaas')
@Controller('public/asaas/webhook')
export class AsaasWebhookController {
  constructor(private readonly inbound: AsaasInboundService) {}

  @Post()
  receive(
    @Body() body: Record<string, unknown>,
    @Headers('asaas-access-token') accessToken?: string,
  ) {
    this.inbound.assertWebhookAuthorized(accessToken);
    return this.inbound.handleWebhook(body as never);
  }
}
