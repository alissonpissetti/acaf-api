import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { SupportTicketsService } from './support-tickets.service';
import type {
  CreateSupportTicketInput,
  CreateSupportTicketMessageInput,
  SupportTicketListQuery,
  SupportTicketPriority,
  SupportTicketQueue,
  SupportTicketSource,
  SupportTicketStatus,
  UpdateSupportTicketInput,
} from './support.types';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Atendimento')
@ApiBearerAuth('admin-jwt')
@Controller('admin/support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get('catalog')
  async catalog() {
    return this.tickets.getCatalog();
  }

  @Get('stats')
  stats(@Req() req: AuthRequest, @Query('queue') queue?: SupportTicketQueue) {
    return this.tickets.getQueueStats(req.user.userId, queue);
  }

  @Get('tickets')
  list(
    @Req() req: AuthRequest,
    @Query('mineOnly') mineOnly?: string,
    @Query('queue') queue?: SupportTicketQueue,
    @Query('status') status?: SupportTicketStatus,
    @Query('priority') priority?: SupportTicketPriority,
    @Query('source') source?: SupportTicketSource,
    @Query('assignedToMe') assignedToMe?: string,
    @Query('openOnly') openOnly?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: 'updatedAt' | 'createdAt' | 'priority',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: SupportTicketListQuery = {
      mineOnly: mineOnly !== '0',
      queue,
      status,
      priority,
      source,
      assignedToMe: assignedToMe === '1',
      openOnly: openOnly === '1',
      q,
      sort,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    };
    return this.tickets.listTickets(req.user.userId, undefined, query);
  }

  @Post('tickets')
  create(@Req() req: AuthRequest, @Body() body: CreateSupportTicketInput) {
    return this.tickets.createTicket(req.user.userId, 'admin', body);
  }

  @Get('tickets/:id')
  get(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.tickets.getTicket(req.user.userId, id, 'admin');
  }

  @Post('tickets/:id/messages')
  addMessage(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: CreateSupportTicketMessageInput,
  ) {
    return this.tickets.addMessage(req.user.userId, id, body, 'admin');
  }

  @Patch('tickets/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('atendimento.chamados.manage')
  update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: UpdateSupportTicketInput) {
    return this.tickets.updateTicket(req.user.userId, id, body);
  }
}
