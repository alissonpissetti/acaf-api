import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { CashEntryStatus } from './cash-entry.types';
import type { PayableAttachmentKind } from './account-payable.entity';
import type { ReceivableAttachmentKind } from './receivable-counterparty.types';
import { FinanceService } from './finance.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Finance')
@ApiBearerAuth('admin-jwt')
@Controller('admin/finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('cost-centers')
  @RequirePermissions('financeiro.centros-custo')
  listCostCenters() {
    return this.finance.listCostCenters();
  }

  @Post('cost-centers')
  @RequirePermissions('financeiro.centros-custo.manage')
  createCostCenter(@Body() body: Record<string, unknown>) {
    return this.finance.createCostCenter(body as never);
  }

  @Patch('cost-centers/:id')
  @RequirePermissions('financeiro.centros-custo.manage')
  updateCostCenter(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.finance.updateCostCenter(id, body as never);
  }

  @Get('account-plans')
  @RequirePermissions('financeiro.planos-conta')
  listAccountPlans(@Query('kind') kind?: 'expense' | 'revenue') {
    return this.finance.listAccountPlans(kind ? { kind } : undefined);
  }

  @Get('account-plans/options')
  @RequirePermissions('financeiro.contas-pagar', 'financeiro.contas-receber')
  listAccountPlanOptions(@Query('kind') kind?: 'expense' | 'revenue') {
    return this.finance.listAccountPlanOptions(kind);
  }

  @Get('account-plans/:id')
  @RequirePermissions('financeiro.planos-conta')
  getAccountPlan(@Param('id') id: string) {
    return this.finance.getAccountPlan(id);
  }

  @Post('account-plans')
  @RequirePermissions('financeiro.planos-conta.manage')
  createAccountPlan(@Body() body: Record<string, unknown>) {
    return this.finance.createAccountPlan(body as never);
  }

  @Patch('account-plans/:id')
  @RequirePermissions('financeiro.planos-conta.manage')
  updateAccountPlan(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.finance.updateAccountPlan(id, body as never);
  }

  @Get('suppliers')
  @RequirePermissions('financeiro.fornecedores')
  listSuppliers() {
    return this.finance.listSuppliers();
  }

  @Get('suppliers/options')
  @RequirePermissions('financeiro.contas-pagar')
  listSupplierOptions() {
    return this.finance.listSupplierOptions();
  }

  @Get('suppliers/:id')
  @RequirePermissions('financeiro.fornecedores')
  getSupplier(@Param('id') id: string) {
    return this.finance.getSupplier(id);
  }

  @Post('suppliers')
  @RequirePermissions('financeiro.fornecedores.manage', 'financeiro.contas-pagar.manage')
  createSupplier(@Body() body: Record<string, unknown>) {
    return this.finance.createSupplier(body as never);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('financeiro.fornecedores.manage')
  updateSupplier(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.finance.updateSupplier(id, body as never);
  }

  @Get('payables')
  @RequirePermissions('financeiro.contas-pagar')
  listPayables(
    @Query('status') status?: CashEntryStatus,
    @Query('costCenterId') costCenterId?: string,
  ) {
    return this.finance.listPayables({ status, costCenterId });
  }

  @Post('payables')
  @RequirePermissions('financeiro.contas-pagar.manage')
  createPayable(@Req() req: AuthRequest, @Body() body: Record<string, unknown>) {
    return this.finance.createPayable(req.user.userId, body as never);
  }

  @Patch('payables/:id')
  @RequirePermissions('financeiro.contas-pagar.manage')
  updatePayable(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.finance.updatePayable(id, body as never);
  }

  @Patch('payables/:id/settle')
  @RequirePermissions('financeiro.contas-pagar.manage')
  settlePayable(@Param('id') id: string, @Body() body: { settledAt?: string }) {
    return this.finance.settlePayable(id, body?.settledAt);
  }

  @Delete('payables/:id')
  @RequirePermissions('financeiro.contas-pagar.manage')
  deletePayable(@Param('id') id: string) {
    return this.finance.deletePayable(id);
  }

  @Post('payables/:id/attachments')
  @RequirePermissions('financeiro.contas-pagar.manage')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadPayableAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('kind') kind?: PayableAttachmentKind,
    @Body('settledAt') settledAt?: string,
  ) {
    if (!files?.length) {
      throw new BadRequestException('Envie ao menos um arquivo.');
    }
    return this.finance.uploadPayableAttachments(id, files, { kind, settledAt });
  }

  @Delete('payables/:id/attachments/:attachmentId')
  @RequirePermissions('financeiro.contas-pagar.manage')
  deletePayableAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.finance.deletePayableAttachment(id, attachmentId);
  }

  @Get('receivables')
  @RequirePermissions('financeiro.contas-receber')
  listReceivables(
    @Query('status') status?: CashEntryStatus,
    @Query('costCenterId') costCenterId?: string,
  ) {
    return this.finance.listReceivables({ status, costCenterId });
  }

  @Post('receivables')
  @RequirePermissions('financeiro.contas-receber.manage')
  createReceivable(@Req() req: AuthRequest, @Body() body: Record<string, unknown>) {
    return this.finance.createReceivable(req.user.userId, body as never);
  }

  @Patch('receivables/:id')
  @RequirePermissions('financeiro.contas-receber.manage')
  updateReceivable(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.finance.updateReceivable(id, body as never);
  }

  @Patch('receivables/:id/settle')
  @RequirePermissions('financeiro.contas-receber.manage')
  settleReceivable(@Param('id') id: string, @Body() body: { settledAt?: string }) {
    return this.finance.settleReceivable(id, body?.settledAt);
  }

  @Delete('receivables/:id')
  @RequirePermissions('financeiro.contas-receber.manage')
  deleteReceivable(@Param('id') id: string) {
    return this.finance.deleteReceivable(id);
  }

  @Get('payers/options')
  @RequirePermissions('financeiro.contas-receber')
  listPayerOptions() {
    return this.finance.listPayerOptions();
  }

  @Post('receivables/:id/attachments')
  @RequirePermissions('financeiro.contas-receber.manage')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadReceivableAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('kind') kind?: ReceivableAttachmentKind,
    @Body('settledAt') settledAt?: string,
  ) {
    if (!files?.length) {
      throw new BadRequestException('Envie ao menos um arquivo.');
    }
    return this.finance.uploadReceivableAttachments(id, files, { kind, settledAt });
  }

  @Delete('receivables/:id/attachments/:attachmentId')
  @RequirePermissions('financeiro.contas-receber.manage')
  deleteReceivableAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.finance.deleteReceivableAttachment(id, attachmentId);
  }

  @Get('cash-flow')
  @RequirePermissions('financeiro.fluxo-caixa')
  getCashFlow(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('status') status?: CashEntryStatus,
  ) {
    return this.finance.getCashFlow({ from, to, costCenterId, status });
  }
}
