import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CorporateJwtAuthGuard } from '../corporate-auth/corporate-jwt-auth.guard';
import { SupportTicketsService } from './support-tickets.service';
import type {
  CreateSupportTicketInput,
  CreateSupportTicketMessageInput,
  SupportTicketStatus,
} from './support.types';

type CorporateAuthRequest = Request & {
  user: { userId: string; companyId: string; companyIds: string[] };
};

@ApiTags('Corporativo · Atendimento')
@ApiBearerAuth('corporate-jwt')
@Controller('corporate/support')
@UseGuards(CorporateJwtAuthGuard)
export class CorporateSupportController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get('catalog')
  catalog() {
    return this.tickets.getCatalog();
  }

  @Get('tickets')
  list(
    @Req() req: CorporateAuthRequest,
    @Query('status') status?: SupportTicketStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.tickets.listTickets(req.user.userId, 'corporate', {
      mineOnly: true,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('tickets')
  create(@Req() req: CorporateAuthRequest, @Body() body: CreateSupportTicketInput) {
    return this.tickets.createTicket(req.user.userId, 'corporate', {
      ...body,
      companyId: body.companyId ?? req.user.companyId ?? null,
    });
  }

  @Get('tickets/:id')
  get(@Req() req: CorporateAuthRequest, @Param('id') id: string) {
    return this.tickets.getTicket(req.user.userId, id, 'corporate');
  }

  @Post('tickets/:id/messages')
  addMessage(
    @Req() req: CorporateAuthRequest,
    @Param('id') id: string,
    @Body() body: CreateSupportTicketMessageInput,
  ) {
    return this.tickets.addMessage(req.user.userId, id, body, 'corporate');
  }
}
