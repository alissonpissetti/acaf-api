import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import type { CreateProjectTaskBody, PatchProjectTaskBody } from './project-tasks.dto';
import { ProjectTasksService } from './project-tasks.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Cronograma')
@ApiBearerAuth('admin-jwt')
@Controller('admin/project-tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectTasksAdminController {
  constructor(private readonly projectTasks: ProjectTasksService) {}

  @Get()
  @RequirePermissions('operacao.cronograma')
  list() {
    return this.projectTasks.list();
  }

  @Post('seed/import')
  @RequirePermissions('operacao.cronograma.manage')
  seedImport() {
    return this.projectTasks.runSeed(true);
  }

  @Post()
  @RequirePermissions('operacao.cronograma.manage')
  create(@Req() req: AuthRequest, @Body() body: CreateProjectTaskBody) {
    return this.projectTasks.create(body, req.user.userId);
  }

  @Get(':id/events')
  @RequirePermissions('operacao.cronograma')
  events(@Param('id') id: string) {
    return this.projectTasks.listEvents(id);
  }

  @Patch(':id')
  @RequirePermissions('operacao.cronograma.manage')
  patch(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: PatchProjectTaskBody) {
    return this.projectTasks.patch(id, body, req.user.userId);
  }

  @Delete(':id')
  @RequirePermissions('operacao.cronograma.manage')
  remove(@Param('id') id: string) {
    return this.projectTasks.remove(id);
  }

}