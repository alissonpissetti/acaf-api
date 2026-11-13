import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { TransactionService } from './transaction.service';

@ApiTags('Admin · Finance')
@ApiBearerAuth('admin-jwt')
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TransactionController {
  constructor(private readonly transactions: TransactionService) {}

  @Get('users/:id/transactions')
  @RequirePermissions('financeiro.contas-receber')
  listForUser(@Param('id') userId: string) {
    return this.transactions.listForUser(userId);
  }

  @Get('finance/transactions/:id')
  @RequirePermissions('financeiro.contas-receber')
  getById(@Param('id') id: string) {
    return this.transactions.getById(id);
  }

}
