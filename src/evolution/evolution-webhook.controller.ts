import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EvolutionInboundService } from './evolution-inbound.service';

@ApiTags('Public · Evolution')
@Controller('public/evolution/webhook')
export class EvolutionWebhookController {
  constructor(private readonly inbound: EvolutionInboundService) {}

  @Post()
  receive(
    @Body() body: Record<string, unknown>,
    @Headers('x-evolution-webhook-secret') secret?: string,
    @Headers('apikey') apiKeyHeader?: string,
  ) {
    this.inbound.assertWebhookAuthorized(secret ?? apiKeyHeader);
    return this.inbound.handleWebhook(body);
  }
}
