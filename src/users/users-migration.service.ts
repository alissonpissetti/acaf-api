import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformUser } from '../platform-users/platform-user.entity';
import { UnitPartnerAccess } from '../platform-users/unit-partner-access.entity';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersMigrationService implements OnModuleInit {
  private readonly logger = new Logger(UsersMigrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PlatformUser)
    private readonly platformUsers: Repository<PlatformUser>,
    @InjectRepository(UnitPartnerAccess)
    private readonly access: Repository<UnitPartnerAccess>,
  ) {}

  async onModuleInit() {
    await this.migrateLegacyAdminUsers();
    await this.migratePlatformUsers();
    await this.migratePartnerAccess();
    await this.fixRolesColumn();
  }

  private async fixRolesColumn() {
    if (!(await this.tableExists('acaf_users'))) return;

    await this.dataSource.query(`
      UPDATE acaf_users
      SET roles = JSON_ARRAY('member')
      WHERE roles IS NULL
        AND (email LIKE '%@email.com' OR email LIKE '%@test.com')
    `);

    await this.dataSource.query(`
      UPDATE acaf_users
      SET roles = JSON_ARRAY('admin')
      WHERE roles IS NULL
        AND password_hash IS NOT NULL
        AND email NOT LIKE '%@email.com'
        AND email NOT LIKE '%@test.com'
    `);

    await this.dataSource.query(`
      UPDATE acaf_users
      SET roles = JSON_ARRAY('admin')
      WHERE roles IS NULL
        AND name IN ('Administrador', 'Alisson')
    `);

    await this.dataSource.query(`
      UPDATE acaf_users
      SET roles = JSON_ARRAY('member')
      WHERE roles IS NULL
    `);
  }

  private async tableExists(name: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
      [name],
    );
    return rows.length > 0;
  }

  private async migrateLegacyAdminUsers() {
    if (!(await this.tableExists('acaf_admin_users'))) return;

    const legacyRows: Array<{
      id: string;
      name: string;
      email: string;
      cpf: string | null;
      mobile_phone: string | null;
      password_hash: string;
      role: string;
      active: number | boolean;
      created_at: Date;
      updated_at: Date;
    }> = await this.dataSource.query('SELECT * FROM acaf_admin_users');

    for (const row of legacyRows) {
      const existing = await this.users.findOne({
        where: [{ id: row.id }, { email: row.email.toLowerCase().trim() }],
      });
      if (existing) continue;

      await this.users.save(
        this.users.create({
          id: row.id,
          name: row.name,
          email: row.email.toLowerCase().trim(),
          cpf: row.cpf,
          mobilePhone: row.mobile_phone,
          passwordHash: row.password_hash,
          roles: [UserRole.ADMIN],
          active: Boolean(row.active),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      );
    }

    this.logger.log(`Migrados ${legacyRows.length} usuário(s) de acaf_admin_users.`);
  }

  private async migratePlatformUsers() {
    const platformRows = await this.platformUsers.find();
    if (!platformRows.length) return;

    let migrated = 0;
    for (const row of platformRows) {
      const email = row.email.toLowerCase().trim();
      let user =
        (await this.users.findOne({ where: { id: row.id } })) ??
        (await this.users.findOne({ where: { email } }));

      if (!user) {
        user = this.users.create({
          id: row.id,
          name: row.name,
          email,
          cpf: row.cpf,
          passwordHash: row.passwordHash,
          roles: [],
          active: row.active,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        migrated += 1;
      } else {
        if (!user.passwordHash && row.passwordHash) user.passwordHash = row.passwordHash;
        if (!user.cpf && row.cpf) user.cpf = row.cpf;
        if (user.name.trim().length < row.name.trim().length) user.name = row.name;
      }

      await this.users.save(user);
    }

    this.logger.log(`Sincronizados ${platformRows.length} usuário(s) de acaf_platform_users (${migrated} novos).`);
  }

  private async migratePartnerAccess() {
    const rows = await this.access.find();
    let updated = 0;

    for (const row of rows) {
      if (row.userId) continue;

      const legacyId = row.adminUserId ?? row.platformUserId;
      if (!legacyId) continue;

      let user = await this.users.findOne({ where: { id: legacyId } });
      if (!user && row.platformUserId) {
        const platform = await this.platformUsers.findOne({ where: { id: row.platformUserId } });
        if (platform) {
          user = await this.users.findOne({ where: { email: platform.email.toLowerCase().trim() } });
        }
      }

      if (!user) continue;

      row.userId = user.id;
      await this.access.save(row);
      updated += 1;
    }

    if (updated) {
      this.logger.log(`Atualizados ${updated} vínculo(s) de acesso parceiro para acaf_users.`);
    }
  }
}
