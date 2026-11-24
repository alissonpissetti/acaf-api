import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import type {
  CreateProjectTaskBody,
  CreateProjectTaskCommentBody,
  PatchProjectTaskBody,
} from './project-tasks.dto';
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

  @Get(':id/comments')
  @RequirePermissions('operacao.cronograma')
  comments(@Param('id') id: string) {
    return this.projectTasks.listComments(id);
  }

  @Post(':id/comments')
  @RequirePermissions('operacao.cronograma.manage')
  addComment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: CreateProjectTaskCommentBody,
  ) {
    return this.projectTasks.addComment(id, req.user.userId, body);
  }

  @Get(':id/attachments')
  @RequirePermissions('operacao.cronograma')
  attachments(@Param('id') id: string) {
    return this.projectTasks.listAttachments(id);
  }

  @Post(':id/attachments')
  @RequirePermissions('operacao.cronograma.manage')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadAttachments(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Envie ao menos um arquivo.');
    return this.projectTasks.uploadAttachments(id, req.user.userId, files);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('operacao.cronograma.manage')
  deleteAttachment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectTasks.removeAttachment(id, attachmentId, req.user.userId);
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