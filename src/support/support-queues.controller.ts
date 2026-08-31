import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import {
  SupportQueuesService,
  type CreateSupportQueueInput,
  type UpdateSupportQueueInput,
} from './support-queues.service';

@ApiTags('Admin · Atendimento')
@ApiBearerAuth('admin-jwt')
@Controller('admin/support/queues')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupportQueuesController {
  constructor(private readonly queues: SupportQueuesService) {}

  @Get()
  @RequirePermissions('atendimento.filas')
  list(@Query('all') all?: string) {
    return all === '1' ? this.queues.listAll() : this.queues.list(false);
  }

  @Get('meta/categories')
  @RequirePermissions('atendimento.filas')
  categories() {
    return this.queues.getCategoryOptions();
  }

  @Get(':id')
  @RequirePermissions('atendimento.filas')
  get(@Param('id') id: string) {
    return this.queues.getById(id);
  }

  @Post()
  @RequirePermissions('atendimento.filas.manage')
  create(@Body() body: CreateSupportQueueInput) {
    return this.queues.create(body);
  }

  @Patch(':id')
  @RequirePermissions('atendimento.filas.manage')
  update(@Param('id') id: string, @Body() body: UpdateSupportQueueInput) {
    return this.queues.update(id, body);
  }
}
