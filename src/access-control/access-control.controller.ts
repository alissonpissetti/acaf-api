import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  DepartmentsService,
  JobPositionsService,
  ModulesAdminService,
  NavigationService,
  PermissionsService,
  UserGroupsService,
} from './access-control.service';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Access Control')
@ApiBearerAuth('admin-jwt')
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AccessControlController {
  constructor(
    private readonly navigation: NavigationService,
    private readonly permissions: PermissionsService,
    private readonly modules: ModulesAdminService,
    private readonly groups: UserGroupsService,
    private readonly departments: DepartmentsService,
    private readonly jobPositions: JobPositionsService,
  ) {}

  @Get('navigation')
  navigationForUser(@Req() req: AuthRequest) {
    return this.navigation.getNavigationForUser(req.user.userId);
  }

  @Get('permissions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos', 'sistema.modulos')
  listPermissions() {
    return this.permissions.listAll();
  }

  @Get('modules')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos')
  listModules() {
    return this.modules.listModules();
  }

  @Post('modules')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos.manage')
  createModule(@Body() body: Record<string, unknown>) {
    return this.modules.createModule(body as never);
  }

  @Patch('modules/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos.manage')
  updateModule(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.modules.updateModule(id, body as never);
  }

  @Post('modules/:moduleId/items')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos.manage')
  createItem(@Param('moduleId') moduleId: string, @Body() body: Record<string, unknown>) {
    return this.modules.createItem(moduleId, body as never);
  }

  @Patch('module-items/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos.manage')
  updateItem(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.modules.updateItem(id, body as never);
  }

  @Patch('permissions/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.modulos.manage')
  updatePermission(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.modules.updatePermission(id, body as never);
  }

  @Get('user-groups')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos')
  listGroups() {
    return this.groups.list();
  }

  @Post('user-groups')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos.manage')
  createGroup(@Body() body: Record<string, unknown>) {
    return this.groups.create(body as never);
  }

  @Patch('user-groups/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos.manage')
  updateGroup(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.groups.update(id, body as never);
  }

  @Get('user-groups/:id/permissions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos')
  getGroupPermissions(@Param('id') id: string) {
    return this.groups.getPermissions(id);
  }

  @Put('user-groups/:id/permissions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.grupos.manage')
  setGroupPermissions(@Param('id') id: string, @Body() body: { permissionIds: string[] }) {
    return this.groups.setPermissions(id, body.permissionIds ?? []);
  }

  @Get('departments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.departamentos')
  listDepartments() {
    return this.departments.list();
  }

  @Post('departments')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.departamentos.manage')
  createDepartment(@Body() body: Record<string, unknown>) {
    return this.departments.create(body as never);
  }

  @Patch('departments/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.departamentos.manage')
  updateDepartment(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.departments.update(id, body as never);
  }

  @Get('job-positions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.cargos')
  listJobPositions() {
    return this.jobPositions.list();
  }

  @Post('job-positions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.cargos.manage')
  createJobPosition(@Body() body: Record<string, unknown>) {
    return this.jobPositions.create(body as never);
  }

  @Patch('job-positions/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.cargos.manage')
  updateJobPosition(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.jobPositions.update(id, body as never);
  }
}
