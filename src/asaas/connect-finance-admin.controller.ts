import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { ConnectTransactionBackfillService } from './connect-transaction-backfill.service';

@ApiTags('Admin · Finance')
@ApiBearerAuth('admin-jwt')
@Controller('admin/finance/transactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConnectFinanceAdminController {
  constructor(private readonly backfill: ConnectTransactionBackfillService) {}

  /** Idempotente: relinka usuários da assinatura e cria/atualiza transações + tentativas de gateway. */
  @Post('backfill')
  @RequirePermissions('financeiro.contas-receber.manage')
  runBackfill(@Body() body: { limit?: number; fetchFromAsaas?: boolean } | undefined) {
    return this.backfill.run({
      limit: body?.limit,
      fetchFromAsaas: body?.fetchFromAsaas,
    });
  }
}
