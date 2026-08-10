import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CorporateAccessService } from './corporate-access.service';
import { CorporateCompaniesService } from './corporate-companies.service';
import { CorporateEmployeesService } from './corporate-employees.service';
import { CorporateInvoicesService } from './corporate-invoices.service';
import { CorporateJwtAuthGuard } from '../corporate-auth/corporate-jwt-auth.guard';

type CorpRequest = Request & {
  user: { userId: string; companyIds: string[]; companyId: string };
};

@ApiTags('Corporativo')
@ApiBearerAuth('corporate-jwt')
@Controller('corporate')
export class CorporateController {
  constructor(
    private readonly access: CorporateAccessService,
    private readonly employees: CorporateEmployeesService,
    private readonly invoices: CorporateInvoicesService,
    private readonly companies: CorporateCompaniesService,
  ) {}

  private async companyFromReq(req: CorpRequest) {
    return this.access.assertCompanyAccess(req.user.userId, req.user.companyId);
  }

  @Get('employees')
  @UseGuards(CorporateJwtAuthGuard)
  async listEmployees(@Req() req: CorpRequest) {
    const company = await this.companyFromReq(req);
    return this.employees.listEmployees(company.id);
  }

  @Post('employees')
  @UseGuards(CorporateJwtAuthGuard)
  async addEmployee(
    @Req() req: CorpRequest,
    @Body() body: { name: string; email: string; cpf?: string; mobilePhone: string },
  ) {
    const company = await this.companyFromReq(req);
    return this.employees.addEmployee(company, body);
  }

  @Patch('employees/:id')
  @UseGuards(CorporateJwtAuthGuard)
  async patchEmployee(
    @Req() req: CorpRequest,
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'inactive' },
  ) {
    const company = await this.companyFromReq(req);
    return this.employees.updateEmployeeStatus(company.id, id, body.status);
  }

  @Get('employees/:id/invite-link')
  @UseGuards(CorporateJwtAuthGuard)
  async getInviteLink(@Req() req: CorpRequest, @Param('id') id: string) {
    const company = await this.companyFromReq(req);
    return this.employees.getInviteLink(company, id);
  }

  @Post('employees/:id/send-invite-email')
  @UseGuards(CorporateJwtAuthGuard)
  async sendInviteEmail(@Req() req: CorpRequest, @Param('id') id: string) {
    const company = await this.companyFromReq(req);
    return this.employees.sendInviteEmail(company, id);
  }

  @Post('employees/:id/send-invite-sms')
  @UseGuards(CorporateJwtAuthGuard)
  async sendInviteSms(@Req() req: CorpRequest, @Param('id') id: string) {
    const company = await this.companyFromReq(req);
    return this.employees.sendInviteSms(company, id);
  }

  @Post('employees/:id/resend-invite')
  @UseGuards(CorporateJwtAuthGuard)
  async resendInvite(@Req() req: CorpRequest, @Param('id') id: string) {
    const company = await this.companyFromReq(req);
    return this.employees.resendInvite(company, id);
  }

  @Get('invoices')
  @UseGuards(CorporateJwtAuthGuard)
  async listInvoices(@Req() req: CorpRequest) {
    const company = await this.companyFromReq(req);
    return this.invoices.listInvoices(company);
  }

  @Get('invoices/:monthKey')
  @UseGuards(CorporateJwtAuthGuard)
  async getInvoice(@Req() req: CorpRequest, @Param('monthKey') monthKey: string) {
    const company = await this.companyFromReq(req);
    return this.invoices.getInvoice(company, monthKey);
  }

  @Get('invites/:token')
  getInvite(@Param('token') token: string) {
    return this.employees.getInvitePreview(token);
  }

  @Post('invites/:token/accept')
  acceptInvite(
    @Param('token') token: string,
    @Body() body: { password: string; cpf: string; name?: string },
  ) {
    return this.employees.acceptInvite(token, body);
  }
}
