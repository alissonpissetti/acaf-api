import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../access-control/access-control.service';
import { Association } from '../associations/association.entity';
import { associationPartnersPermissionKey } from '../associations/association-permissions';
import { User } from '../users/user.entity';

@Injectable()
export class AuthPortalEligibilityService {
  constructor(
    private readonly permissions: PermissionsService,
    @InjectRepository(Association)
    private readonly associations: Repository<Association>,
  ) {}

  async canAccessAssociationPortal(user: User): Promise<boolean> {
    if (!user.active || !user.associationId) return false;
    const association = await this.associations.findOne({
      where: { id: user.associationId, active: true },
    });
    if (!association) return false;
    const key = associationPartnersPermissionKey(association.slug);
    return this.permissions.userHasPermission(user.id, key);
  }

}