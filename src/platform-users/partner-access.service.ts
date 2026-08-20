import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { UnitPartnerAccess } from './unit-partner-access.entity';

export type LinkedPartnerUser = {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  active: boolean;
  roles: UserRole[];
  roleLabels: string[];
  accessId: string;
  linkedAt: Date;
};

@Injectable()
export class PartnerAccessService {
  constructor(
    @InjectRepository(UnitPartnerAccess)
    private readonly access: Repository<UnitPartnerAccess>,
    private readonly users: UsersService,
  ) {}

  async listUnitPartnerUsers(unitId: string): Promise<LinkedPartnerUser[]> {
    const rows = await this.access.find({
      where: { unitId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    return rows
      .filter((row) => row.userId && row.user?.active)
      .map((row) => {
        const safe = this.users.toSafeUser(row.user);
        return {
          id: safe.id,
          name: safe.name,
          email: safe.email,
          cpf: safe.cpf,
          active: safe.active,
          roles: safe.roles,
          roleLabels: safe.roleLabels,
          accessId: row.id,
          linkedAt: row.createdAt,
        };
      });
  }

  async listUnitIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.access.find({
      where: { userId },
      select: ['unitId'],
    });
    return rows.map((row) => row.unitId);
  }

  async linkUserToUnit(unitId: string, userId: string): Promise<LinkedPartnerUser> {
    const user = await this.users.findById(userId);
    if (!user?.active) throw new NotFoundException('Usuário não encontrado.');

    let row = await this.access.findOne({ where: { unitId, userId } });
    if (!row) {
      row = await this.access.save(
        this.access.create({ unitId, userId, platformUserId: null, adminUserId: null }),
      );
    }

    const safe = this.users.toSafeUser(user);
    return {
      id: safe.id,
      name: safe.name,
      email: safe.email,
      cpf: safe.cpf,
      active: safe.active,
      roles: safe.roles,
      roleLabels: safe.roleLabels,
      accessId: row.id,
      linkedAt: row.createdAt,
    };
  }

  async unlinkUserFromUnit(unitId: string, userId: string): Promise<void> {
    const row = await this.access.findOne({ where: { unitId, userId } });
    if (!row) throw new NotFoundException('Usuário não vinculado a esta unidade.');
    await this.access.remove(row);
  }

  async removeAccessForUnit(unitId: string): Promise<void> {
    await this.access.delete({ unitId });
  }

  async countLinkedUsersForUnits(unitIds: string[]): Promise<number> {
    if (!unitIds.length) return 0;

    const row = await this.access
      .createQueryBuilder('access')
      .select('COUNT(DISTINCT access.userId)', 'count')
      .where('access.unitId IN (:...unitIds)', { unitIds })
      .andWhere('access.userId IS NOT NULL')
      .getRawOne<{ count: string }>();

    return Number(row?.count ?? 0);
  }

  async countLinkedUsersForUnit(unitId: string): Promise<number> {
    return this.countLinkedUsersForUnits([unitId]);
  }
}
