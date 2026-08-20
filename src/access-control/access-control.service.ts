import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';
import { User, UserRole, userHasRole } from '../users/user.entity';
import {
  ACCESS_CONTROL_SEED,
  ADMIN_GROUP_NAME,
  COMMERCIAL_GROUP_NAME,
  FINANCE_COST_CENTER_CODE,
  FINANCE_DEPARTMENT_NAME,
  FINANCE_GROUP_NAME,
} from './access-control.seed';
import { Department } from './department.entity';
import { GroupPermission } from './group-permission.entity';
import { JobPosition } from './job-position.entity';
import { ModuleItem } from './module-item.entity';
import { NavModule } from './nav-module.entity';
import { Permission } from './permission.entity';
import { UserGroup } from './user-group.entity';
import { CostCenter } from '../finance/cost-center.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserGroup)
    private readonly groups: Repository<UserGroup>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissions: Repository<GroupPermission>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
  ) {}

  async getAdminGroup(): Promise<UserGroup | null> {
    return this.groups.findOne({ where: { name: ADMIN_GROUP_NAME } });
  }

  async getUserPermissionKeys(userId: string): Promise<string[]> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !userHasRole(user, UserRole.ADMIN)) return [];

    let groupId = user.userGroupId;
    if (!groupId) {
      const adminGroup = await this.getAdminGroup();
      groupId = adminGroup?.id ?? null;
    }
    if (!groupId) return [];

    const rows = await this.groupPermissions.find({
      where: { groupId },
      relations: ['permission'],
    });

    return rows.map((row) => row.permission.key).sort();
  }

  async userHasPermission(userId: string, key: string): Promise<boolean> {
    const keys = await this.getUserPermissionKeys(userId);
    return keys.includes(key);
  }

  async userHasAnyPermission(userId: string, keys: string[]): Promise<boolean> {
    const userKeys = await this.getUserPermissionKeys(userId);
    return keys.some((key) => userKeys.includes(key));
  }

  async listAll() {
    const rows = await this.permissions.find({ order: { key: 'ASC' } });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      moduleItemId: row.moduleItemId,
    }));
  }
}

@Injectable()
export class AccessControlSeedService implements OnModuleInit {
  private readonly logger = new Logger(AccessControlSeedService.name);

  constructor(
    @InjectRepository(NavModule)
    private readonly modules: Repository<NavModule>,
    @InjectRepository(ModuleItem)
    private readonly items: Repository<ModuleItem>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(UserGroup)
    private readonly groups: Repository<UserGroup>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissions: Repository<GroupPermission>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(JobPosition)
    private readonly jobPositions: Repository<JobPosition>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(CostCenter)
    private readonly costCenters: Repository<CostCenter>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedModulesAndPermissions();
    await this.seedGroups();
    await this.seedOrganization();
    await this.assignAdminsToDefaultGroup();
    await this.ensureBootstrapAdminUser();
  }

  private async seedModulesAndPermissions() {
    const seededModuleSlugs = new Set(ACCESS_CONTROL_SEED.map((seed) => seed.slug));
    const seededItemSlugs = new Set(
      ACCESS_CONTROL_SEED.flatMap((seed) => seed.items.map((item) => item.slug)),
    );

    for (const seed of ACCESS_CONTROL_SEED) {
      let module = await this.modules.findOne({ where: { slug: seed.slug } });
      if (!module) {
        module = await this.modules.save(
          this.modules.create({
            slug: seed.slug,
            name: seed.name,
            description: seed.description,
            icon: seed.icon,
            sortOrder: seed.sortOrder,
            active: true,
          }),
        );
      } else {
        module.name = seed.name;
        module.description = seed.description;
        module.icon = seed.icon;
        module.sortOrder = seed.sortOrder;
        module.active = true;
        await this.modules.save(module);
      }

      for (const itemSeed of seed.items) {
        let item = await this.items.findOne({ where: { slug: itemSeed.slug } });
        if (!item) {
          item = await this.items.save(
            this.items.create({
              moduleId: module.id,
              slug: itemSeed.slug,
              label: itemSeed.label,
              route: itemSeed.route,
              sortOrder: itemSeed.sortOrder,
              active: true,
            }),
          );
        } else {
          item.moduleId = module.id;
          item.label = itemSeed.label;
          item.route = itemSeed.route;
          item.sortOrder = itemSeed.sortOrder;
          item.active = true;
          await this.items.save(item);
        }

        const viewKey = itemSeed.permissionKey;
        const manageKey = `${itemSeed.permissionKey}.manage`;

        for (const [key, label] of [
          [viewKey, `Ver ${itemSeed.label}`],
          [manageKey, `Gerenciar ${itemSeed.label}`],
        ] as const) {
          let permission = await this.permissions.findOne({ where: { key } });
          if (!permission) {
            permission = this.permissions.create({
              key,
              label,
              moduleItemId: item.id,
            });
          } else {
            permission.label = label;
            permission.moduleItemId = item.id;
          }
          await this.permissions.save(permission);
        }
      }
    }

    const allModules = await this.modules.find();
    for (const module of allModules) {
      if (!seededModuleSlugs.has(module.slug) && module.active) {
        module.active = false;
        await this.modules.save(module);
      }
    }

    const allItems = await this.items.find();
    for (const item of allItems) {
      if (!seededItemSlugs.has(item.slug) && item.active) {
        item.active = false;
        await this.items.save(item);
      }
    }
  }

  private async seedGroups() {
    const allPermissions = await this.permissions.find();
    const adminGroup = await this.ensureGroup(
      ADMIN_GROUP_NAME,
      'Acesso total ao console administrativo',
    );
    await this.syncGroupPermissions(adminGroup.id, allPermissions.map((p) => p.id));

    const financeKeys = allPermissions
      .filter((p) => p.key.startsWith('financeiro.'))
      .map((p) => p.id);
    const financeGroup = await this.ensureGroup(
      FINANCE_GROUP_NAME,
      'Acesso ao módulo financeiro',
    );
    await this.syncGroupPermissions(financeGroup.id, financeKeys);

    const commercialKeys = allPermissions
      .filter((p) => p.key.startsWith('comercial.'))
      .map((p) => p.id);
    const commercialGroup = await this.ensureGroup(
      COMMERCIAL_GROUP_NAME,
      'Acesso ao módulo comercial e pipeline de leads',
    );
    await this.syncGroupPermissions(commercialGroup.id, commercialKeys);
  }

  private async ensureGroup(name: string, description: string) {
    let group = await this.groups.findOne({ where: { name } });
    if (!group) {
      group = await this.groups.save(
        this.groups.create({ name, description, active: true }),
      );
    }
    return group;
  }

  private async syncGroupPermissions(groupId: string, permissionIds: string[]) {
    await this.groupPermissions.delete({ groupId });
    if (!permissionIds.length) return;
    await this.groupPermissions.save(
      permissionIds.map((permissionId) =>
        this.groupPermissions.create({ groupId, permissionId }),
      ),
    );
  }

  private async seedOrganization() {
    let department = await this.departments.findOne({
      where: { name: FINANCE_DEPARTMENT_NAME },
    });
    if (!department) {
      department = await this.departments.save(
        this.departments.create({
          name: FINANCE_DEPARTMENT_NAME,
          description: 'Departamento financeiro da ACAF',
          parentId: null,
          sortOrder: 1,
          active: true,
        }),
      );
    }

    let costCenter = await this.costCenters.findOne({
      where: { code: FINANCE_COST_CENTER_CODE },
    });
    if (!costCenter) {
      costCenter = await this.costCenters.save(
        this.costCenters.create({
          code: FINANCE_COST_CENTER_CODE,
          name: 'Financeiro',
          departmentId: department.id,
          active: true,
        }),
      );
    } else if (!costCenter.departmentId) {
      costCenter.departmentId = department.id;
      await this.costCenters.save(costCenter);
    }

    const existingPosition = await this.jobPositions.findOne({
      where: { name: 'Analista Financeiro', departmentId: department.id },
    });
    if (!existingPosition) {
      await this.jobPositions.save(
        this.jobPositions.create({
          name: 'Analista Financeiro',
          description: 'Responsável por contas a pagar e receber',
          departmentId: department.id,
          parentPositionId: null,
          sortOrder: 1,
          active: true,
        }),
      );
    }
  }

  private async assignAdminsToDefaultGroup() {
    const adminGroup = await this.getAdminGroup();
    if (!adminGroup) return;

    const admins = await this.users.find();
    for (const user of admins) {
      if (!userHasRole(user, UserRole.ADMIN)) continue;
      user.userGroupId = adminGroup.id;
      await this.users.save(user);
    }
  }

  private normalizeRoles(raw: unknown): UserRole[] {
    if (Array.isArray(raw)) return raw.filter(Boolean) as UserRole[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed.filter(Boolean) as UserRole[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private async ensureBootstrapAdminUser() {
    const email = this.config.get<string>('ADMIN_EMAIL')?.toLowerCase().trim();
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD não configurados — bootstrap admin ignorado.');
      return;
    }

    const adminGroup = await this.getAdminGroup();
    const passwordHash = await bcrypt.hash(password, 10);

    let user = await this.users.findOne({ where: { email } });
    if (!user) {
      await this.users.save(
        this.users.create({
          name: 'Administrador',
          email,
          passwordHash,
          roles: [UserRole.ADMIN],
          userGroupId: adminGroup?.id ?? null,
          active: true,
        }),
      );
      this.logger.log(`Usuário admin criado para login: ${email}`);
      return;
    }

    const roles = this.normalizeRoles(user.roles);
    if (!roles.includes(UserRole.ADMIN)) roles.push(UserRole.ADMIN);

    user.roles = roles;
    user.passwordHash = passwordHash;
    user.active = true;
    if (adminGroup) user.userGroupId = adminGroup.id;
    await this.users.save(user);
    this.logger.log(`Usuário admin sincronizado para login: ${email}`);
  }

  private async getAdminGroup() {
    return this.groups.findOne({ where: { name: ADMIN_GROUP_NAME } });
  }
}

@Injectable()
export class NavigationService {
  constructor(
    private readonly permissionsService: PermissionsService,
    @InjectRepository(NavModule)
    private readonly modules: Repository<NavModule>,
    @InjectRepository(ModuleItem)
    private readonly items: Repository<ModuleItem>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
  ) {}

  async getNavigationForUser(userId: string) {
    const permissionKeys = await this.permissionsService.getUserPermissionKeys(userId);
    const permissionSet = new Set(permissionKeys);

    const modules = await this.modules.find({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    const allItems = await this.items.find({
      where: { active: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });

    const allPermissions = await this.permissions.find();
    const viewPermissionByItemId = new Map<string, string>();
    for (const permission of allPermissions) {
      if (!permission.moduleItemId || permission.key.endsWith('.manage')) continue;
      viewPermissionByItemId.set(permission.moduleItemId, permission.key);
    }

    const result = [];
    for (const module of modules) {
      const moduleItems = allItems
        .filter((item) => item.moduleId === module.id)
        .filter((item) => {
          const viewKey = viewPermissionByItemId.get(item.id);
          return viewKey ? permissionSet.has(viewKey) : false;
        })
        .map((item) => ({
          id: item.id,
          slug: item.slug,
          label: item.label,
          route: item.route,
          sortOrder: item.sortOrder,
        }));

      if (!moduleItems.length) continue;

      result.push({
        id: module.id,
        slug: module.slug,
        name: module.name,
        description: module.description,
        icon: module.icon,
        sortOrder: module.sortOrder,
        items: moduleItems,
      });
    }

    return result;
  }
}

@Injectable()
export class ModulesAdminService {
  constructor(
    @InjectRepository(NavModule)
    private readonly modules: Repository<NavModule>,
    @InjectRepository(ModuleItem)
    private readonly items: Repository<ModuleItem>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(UserGroup)
    private readonly groups: Repository<UserGroup>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissions: Repository<GroupPermission>,
  ) {}

  private mapItemPermissions(rows: Permission[]) {
    const view = rows.find((row) => !row.key.endsWith('.manage'));
    const manage = rows.find((row) => row.key.endsWith('.manage'));
    return {
      view: view ? { id: view.id, key: view.key, label: view.label } : null,
      manage: manage ? { id: manage.id, key: manage.key, label: manage.label } : null,
    };
  }

  private async permissionsForItem(itemId: string) {
    const rows = await this.permissions.find({ where: { moduleItemId: itemId } });
    return this.mapItemPermissions(rows);
  }

  private async attachPermissionsToModules(
    modules: NavModule[],
    items: ModuleItem[],
  ) {
    const permissionRows = await this.permissions.find();
    return modules.map((module) => ({
      id: module.id,
      slug: module.slug,
      name: module.name,
      description: module.description,
      icon: module.icon,
      sortOrder: module.sortOrder,
      active: module.active,
      items: items
        .filter((item) => item.moduleId === module.id)
        .map((item) => ({
          id: item.id,
          slug: item.slug,
          label: item.label,
          route: item.route,
          sortOrder: item.sortOrder,
          active: item.active,
          permissions: this.mapItemPermissions(
            permissionRows.filter((row) => row.moduleItemId === item.id),
          ),
        })),
    }));
  }

  private buildPermissionKey(moduleSlug: string, itemSlug: string) {
    return `${moduleSlug.trim()}.${itemSlug.trim()}`;
  }

  private buildRoute(moduleSlug: string, itemSlug: string) {
    return `/m/${moduleSlug.trim()}/${itemSlug.trim()}`;
  }

  private async ensureItemPermissions(
    module: NavModule,
    item: ModuleItem,
    permissionKey?: string,
  ) {
    const baseKey = permissionKey?.trim() || this.buildPermissionKey(module.slug, item.slug);
    const created: Permission[] = [];

    for (const [suffix, labelPrefix] of [
      ['', 'Ver'],
      ['.manage', 'Gerenciar'],
    ] as const) {
      const key = `${baseKey}${suffix}`;
      let permission = await this.permissions.findOne({ where: { key } });
      if (!permission) {
        permission = this.permissions.create({
          key,
          label: `${labelPrefix} ${item.label}`,
          moduleItemId: item.id,
        });
      } else {
        permission.moduleItemId = item.id;
        permission.label = `${labelPrefix} ${item.label}`;
      }
      created.push(await this.permissions.save(permission));
    }

    await this.assignPermissionsToAdminGroup(created.map((row) => row.id));
    return this.mapItemPermissions(created);
  }

  private async assignPermissionsToAdminGroup(permissionIds: string[]) {
    const adminGroup = await this.groups.findOne({ where: { name: ADMIN_GROUP_NAME } });
    if (!adminGroup || !permissionIds.length) return;

    const existing = await this.groupPermissions.find({ where: { groupId: adminGroup.id } });
    const existingIds = new Set(existing.map((row) => row.permissionId));
    const toInsert = permissionIds.filter((id) => !existingIds.has(id));
    if (!toInsert.length) return;

    await this.groupPermissions.save(
      toInsert.map((permissionId) =>
        this.groupPermissions.create({ groupId: adminGroup.id, permissionId }),
      ),
    );
  }

  private async syncItemPermissionKeys(module: NavModule, item: ModuleItem, baseKey: string) {
    const rows = await this.permissions.find({ where: { moduleItemId: item.id } });
    for (const row of rows) {
      row.key = row.key.endsWith('.manage') ? `${baseKey}.manage` : baseKey;
      row.label = row.key.endsWith('.manage')
        ? `Gerenciar ${item.label}`
        : `Ver ${item.label}`;
      await this.permissions.save(row);
    }
  }

  async listModules() {
    const modules = await this.modules.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    const items = await this.items.find({ order: { sortOrder: 'ASC', label: 'ASC' } });
    return this.attachPermissionsToModules(modules, items);
  }

  async createModule(body: {
    slug: string;
    name: string;
    description?: string;
    icon?: string;
    sortOrder?: number;
    active?: boolean;
  }) {
    const slug = body.slug?.trim();
    const name = body.name?.trim();
    if (!slug || !name) {
      throw new BadRequestException('Informe slug e nome do módulo.');
    }

    const existing = await this.modules.findOne({ where: { slug } });
    if (existing) throw new BadRequestException('Já existe um módulo com este slug.');

    const saved = await this.modules.save(
      this.modules.create({
        slug,
        name,
        description: body.description?.trim() || null,
        icon: body.icon?.trim() || 'LayoutGrid',
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      }),
    );

    const [mapped] = await this.attachPermissionsToModules([saved], []);
    return mapped;
  }

  async updateModule(
    id: string,
    body: Partial<{
      slug: string;
      name: string;
      description: string;
      icon: string;
      sortOrder: number;
      active: boolean;
    }>,
  ) {
    const module = await this.modules.findOne({ where: { id } });
    if (!module) throw new NotFoundException('Módulo não encontrado.');

    const previousSlug = module.slug;

    if (body.slug !== undefined) {
      const slug = body.slug.trim();
      if (!slug) throw new BadRequestException('Slug inválido.');
      const duplicate = await this.modules.findOne({ where: { slug } });
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Já existe um módulo com este slug.');
      }
      module.slug = slug;
    }
    if (body.name !== undefined) module.name = body.name.trim();
    if (body.description !== undefined) module.description = body.description?.trim() || null;
    if (body.icon !== undefined) module.icon = body.icon.trim();
    if (body.sortOrder !== undefined) module.sortOrder = body.sortOrder;
    if (body.active !== undefined) module.active = body.active;

    const saved = await this.modules.save(module);

    if (body.slug !== undefined && previousSlug !== saved.slug) {
      const moduleItems = await this.items.find({ where: { moduleId: saved.id } });
      for (const item of moduleItems) {
        item.route = this.buildRoute(saved.slug, item.slug);
        await this.items.save(item);
        await this.syncItemPermissionKeys(
          saved,
          item,
          this.buildPermissionKey(saved.slug, item.slug),
        );
      }
    }

    const moduleItems = await this.items.find({ where: { moduleId: saved.id } });
    const [mapped] = await this.attachPermissionsToModules([saved], moduleItems);
    return mapped;
  }

  async createItem(
    moduleId: string,
    body: {
      slug: string;
      label: string;
      route?: string;
      sortOrder?: number;
      active?: boolean;
      permissionKey?: string;
    },
  ) {
    const module = await this.modules.findOne({ where: { id: moduleId } });
    if (!module) throw new NotFoundException('Módulo não encontrado.');

    const slug = body.slug?.trim();
    const label = body.label?.trim();
    if (!slug || !label) {
      throw new BadRequestException('Informe slug e label do item.');
    }

    const duplicate = await this.items.findOne({ where: { moduleId, slug } });
    if (duplicate) throw new BadRequestException('Já existe um item com este slug neste módulo.');

    const saved = await this.items.save(
      this.items.create({
        moduleId,
        slug,
        label,
        route: body.route?.trim() || this.buildRoute(module.slug, slug),
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      }),
    );

    const permissions = await this.ensureItemPermissions(module, saved, body.permissionKey);

    return {
      id: saved.id,
      slug: saved.slug,
      label: saved.label,
      route: saved.route,
      sortOrder: saved.sortOrder,
      active: saved.active,
      permissions,
    };
  }

  async updateItem(
    id: string,
    body: Partial<{
      slug: string;
      label: string;
      route: string;
      sortOrder: number;
      active: boolean;
      permissionKey: string;
    }>,
  ) {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Item não encontrado.');

    const module = await this.modules.findOne({ where: { id: item.moduleId } });
    if (!module) throw new NotFoundException('Módulo não encontrado.');

    if (body.slug !== undefined) {
      const slug = body.slug.trim();
      if (!slug) throw new BadRequestException('Slug inválido.');
      const duplicate = await this.items.findOne({ where: { moduleId: item.moduleId, slug } });
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Já existe um item com este slug neste módulo.');
      }
      item.slug = slug;
    }
    if (body.label !== undefined) item.label = body.label.trim();
    if (body.route !== undefined) item.route = body.route.trim();
    if (body.sortOrder !== undefined) item.sortOrder = body.sortOrder;
    if (body.active !== undefined) item.active = body.active;

    if (body.route === undefined && body.slug !== undefined) {
      item.route = this.buildRoute(module.slug, item.slug);
    }

    const saved = await this.items.save(item);

    const baseKey =
      body.permissionKey?.trim() || this.buildPermissionKey(module.slug, saved.slug);
    await this.syncItemPermissionKeys(module, saved, baseKey);

    const permissions = await this.permissionsForItem(saved.id);
    return {
      id: saved.id,
      slug: saved.slug,
      label: saved.label,
      route: saved.route,
      sortOrder: saved.sortOrder,
      active: saved.active,
      permissions,
    };
  }

  async updatePermission(
    id: string,
    body: Partial<{ key: string; label: string }>,
  ) {
    const permission = await this.permissions.findOne({ where: { id } });
    if (!permission) throw new NotFoundException('Permissão não encontrada.');

    if (body.key !== undefined) {
      const key = body.key.trim();
      if (!key) throw new BadRequestException('Chave de permissão inválida.');
      const duplicate = await this.permissions.findOne({ where: { key } });
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException('Já existe uma permissão com esta chave.');
      }
      permission.key = key;
    }

    if (body.label !== undefined) {
      const label = body.label.trim();
      if (!label) throw new BadRequestException('Informe o rótulo da permissão.');
      permission.label = label;
    }

    const saved = await this.permissions.save(permission);
    return {
      id: saved.id,
      key: saved.key,
      label: saved.label,
      moduleItemId: saved.moduleItemId,
    };
  }
}

@Injectable()
export class UserGroupsService {
  constructor(
    @InjectRepository(UserGroup)
    private readonly groups: Repository<UserGroup>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissions: Repository<GroupPermission>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async list() {
    const groups = await this.groups.find({ order: { name: 'ASC' } });
    const counts = await this.users
      .createQueryBuilder('user')
      .select('user.userGroupId', 'groupId')
      .addSelect('COUNT(*)', 'count')
      .where('user.userGroupId IS NOT NULL')
      .groupBy('user.userGroupId')
      .getRawMany<{ groupId: string; count: string }>();

    const countMap = new Map(counts.map((row) => [row.groupId, Number(row.count)]));

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      active: group.active,
      userCount: countMap.get(group.id) ?? 0,
    }));
  }

  async create(body: { name: string; description?: string; active?: boolean }) {
    return this.groups.save(
      this.groups.create({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        active: body.active ?? true,
      }),
    );
  }

  async update(
    id: string,
    body: Partial<{ name: string; description: string; active: boolean }>,
  ) {
    const group = await this.groups.findOne({ where: { id } });
    if (!group) throw new Error('Grupo não encontrado');
    if (body.name !== undefined) group.name = body.name.trim();
    if (body.description !== undefined) group.description = body.description?.trim() || null;
    if (body.active !== undefined) group.active = body.active;
    return this.groups.save(group);
  }

  async getPermissions(groupId: string) {
    const rows = await this.groupPermissions.find({ where: { groupId } });
    return rows.map((row) => row.permissionId);
  }

  async setPermissions(groupId: string, permissionIds: string[]) {
    await this.groupPermissions.delete({ groupId });
    if (!permissionIds.length) return { ok: true };
    const valid = await this.permissions.find({ where: { id: In(permissionIds) } });
    await this.groupPermissions.save(
      valid.map((permission) =>
        this.groupPermissions.create({ groupId, permissionId: permission.id }),
      ),
    );
    return { ok: true };
  }
}

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(CostCenter)
    private readonly costCenters: Repository<CostCenter>,
  ) {}

  async list() {
    return this.departments.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async create(body: {
    name: string;
    description?: string;
    parentId?: string | null;
    sortOrder?: number;
    active?: boolean;
    createCostCenter?: boolean;
  }) {
    const department = await this.departments.save(
      this.departments.create({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      }),
    );

    if (body.createCostCenter !== false) {
      const code = `DEP-${department.id.slice(0, 8).toUpperCase()}`;
      await this.costCenters.save(
        this.costCenters.create({
          code,
          name: department.name,
          departmentId: department.id,
          active: true,
        }),
      );
    }

    return department;
  }

  async update(
    id: string,
    body: Partial<{
      name: string;
      description: string;
      parentId: string | null;
      sortOrder: number;
      active: boolean;
    }>,
  ) {
    const department = await this.departments.findOne({ where: { id } });
    if (!department) throw new Error('Departamento não encontrado');
    if (body.name !== undefined) department.name = body.name.trim();
    if (body.description !== undefined) department.description = body.description?.trim() || null;
    if (body.parentId !== undefined) department.parentId = body.parentId;
    if (body.sortOrder !== undefined) department.sortOrder = body.sortOrder;
    if (body.active !== undefined) department.active = body.active;
    return this.departments.save(department);
  }
}

@Injectable()
export class JobPositionsService {
  constructor(
    @InjectRepository(JobPosition)
    private readonly positions: Repository<JobPosition>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
  ) {}

  async list() {
    const rows = await this.positions.find({
      relations: ['department'],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      parentPositionId: row.parentPositionId,
      sortOrder: row.sortOrder,
      active: row.active,
    }));
  }

  async create(body: {
    name: string;
    description?: string;
    departmentId: string;
    parentPositionId?: string | null;
    sortOrder?: number;
    active?: boolean;
  }) {
    const department = await this.departments.findOne({ where: { id: body.departmentId } });
    if (!department) throw new Error('Departamento não encontrado');
    return this.positions.save(
      this.positions.create({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        departmentId: body.departmentId,
        parentPositionId: body.parentPositionId ?? null,
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      }),
    );
  }

  async update(
    id: string,
    body: Partial<{
      name: string;
      description: string;
      departmentId: string;
      parentPositionId: string | null;
      sortOrder: number;
      active: boolean;
    }>,
  ) {
    const position = await this.positions.findOne({ where: { id } });
    if (!position) throw new Error('Cargo não encontrado');
    if (body.name !== undefined) position.name = body.name.trim();
    if (body.description !== undefined) position.description = body.description?.trim() || null;
    if (body.departmentId !== undefined) position.departmentId = body.departmentId;
    if (body.parentPositionId !== undefined) position.parentPositionId = body.parentPositionId;
    if (body.sortOrder !== undefined) position.sortOrder = body.sortOrder;
    if (body.active !== undefined) position.active = body.active;
    return this.positions.save(position);
  }
}
