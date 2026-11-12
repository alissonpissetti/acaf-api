import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AcafAssociateMeta, GymUnit } from '../partner/types';
import { AdminService } from '../partner/admin.service';
import { isImportedAssociateMeta } from '../partner/associate-meta';
import { AssociationsService } from '../associations/associations.service';
import { associationPartnersPermissionKey } from '../associations/association-permissions';
import { PermissionsService } from '../access-control/access-control.service';

export type AssociationAssociateUnitPatch = {
  acafAssociate?: Partial<
    Pick<
      AcafAssociateMeta,
      | 'legalName'
      | 'association'
      | 'signedAt'
      | 'contactEmail'
      | 'contactPhone'
      | 'complement'
      | 'listed'
    >
  >;
};

@Injectable()
export class AssociationPortalService {
  constructor(
    private readonly admin: AdminService,
    private readonly associations: AssociationsService,
    private readonly permissions: PermissionsService,
  ) {}

  async assertPortalAccess(userId: string, slug: string) {
    const association = await this.associations.requireBySlug(slug);
    const key = associationPartnersPermissionKey(association.slug);
    const allowed = await this.permissions.userHasPermission(userId, key);
    if (!allowed) {
      throw new ForbiddenException('Você não tem permissão para este portal de associação.');
    }
    return association;
  }

  private unitBelongsToAssociation(unit: GymUnit, associationId: string, slug: string): boolean {
    const meta = unit.acafAssociate;
    if (!isImportedAssociateMeta(meta)) return false;
    if (meta.associationId === associationId) return true;
    if (!meta.associationId && slug === 'acaf' && meta.importSource === 'acaf_associates_xlsx') {
      return true;
    }
    return false;
  }

  async listAssociatePartnerUnits(slug: string): Promise<GymUnit[]> {
    const association = await this.associations.requireBySlug(slug);
    return this.admin
      .listUnits()
      .filter((u) => this.unitBelongsToAssociation(u, association.id, slug));
  }

  async getAssociatePartnerUnit(slug: string, unitId: string): Promise<GymUnit> {
    const association = await this.associations.requireBySlug(slug);
    const unit = this.admin.listUnits().find((u) => u.id === unitId);
    if (!unit || !this.unitBelongsToAssociation(unit, association.id, slug)) {
      throw new NotFoundException('Parceiro associado não encontrado.');
    }
    return unit;
  }

  async patchAssociatePartnerUnit(
    slug: string,
    unitId: string,
    body: AssociationAssociateUnitPatch,
  ): Promise<GymUnit> {
    const current = await this.getAssociatePartnerUnit(slug, unitId);
    const patch = body.acafAssociate;
    if (!patch || !Object.keys(patch).length) {
      throw new BadRequestException('Informe os campos de acafAssociate para atualizar.');
    }
    const prev = current.acafAssociate!;
    const merged: AcafAssociateMeta = { ...prev, ...patch };
    await this.admin.updateUnit(unitId, { acafAssociate: merged });
    return this.getAssociatePartnerUnit(slug, unitId);
  }
}
