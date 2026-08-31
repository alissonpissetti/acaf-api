import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PartnerJwtAuthGuard } from '../partner-auth/partner-jwt-auth.guard';
import { SupportTicketsService } from './support-tickets.service';
import type {
  CreateSupportTicketInput,
  CreateSupportTicketMessageInput,
  SupportTicketStatus,
} from './support.types';

type PartnerAuthRequest = Request & {
  user: { platformUserId: string; unitIds: string[] };
};

@ApiTags('Parceiro · Atendimento')
@ApiBearerAuth('partner-jwt')
@Controller('partner/support')
@UseGuards(PartnerJwtAuthGuard)
export class PartnerSupportController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get('catalog')
  catalog() {
    return this.tickets.getCatalog();
  }

  @Get('tickets')
  list(
    @Req() req: PartnerAuthRequest,
    @Query('status') status?: SupportTicketStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.tickets.listTickets(req.user.platformUserId, 'partner', {
      mineOnly: true,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('tickets')
  create(@Req() req: PartnerAuthRequest, @Body() body: CreateSupportTicketInput) {
    return this.tickets.createTicket(req.user.platformUserId, 'partner', {
      ...body,
      unitId: body.unitId ?? req.user.unitIds[0] ?? null,
    });
  }

  @Get('tickets/:id')
  get(@Req() req: PartnerAuthRequest, @Param('id') id: string) {
    return this.tickets.getTicket(req.user.platformUserId, id, 'partner');
  }

  @Post('tickets/:id/messages')
  addMessage(
    @Req() req: PartnerAuthRequest,
    @Param('id') id: string,
    @Body() body: CreateSupportTicketMessageInput,
  ) {
    return this.tickets.addMessage(req.user.platformUserId, id, body, 'partner');
  }
}
