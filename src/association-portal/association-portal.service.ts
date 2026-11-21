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
import { UsersService } from '../users/users.service';
import { loadStore, updateStoreIf } from '../partner/store';
import {
  countAssociatePayingLivesForUnits,
  countCheckInEventsThisMonth,
  currentAssociatePayingLivesMonthPrefix,
} from '../partner/associatePayingLives';
import { syncAssociateRepasseState } from '../partner/associateRepasseHysteresis';

export type AssociationPortalSummary = {
  unitCount: number;
  networkCount: number;
  unitsListedInCatalog: number;
  primaryMembersCount: number;
  payingLivesCount: number;
  payingLivesMonthKey: string;
  payingLivesCheckInEventsThisMonth: number;
};

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
    private readonly users: UsersService,
  ) {}

  async assertPortalAccess(userId: string, slug: string) {
    const association = await this.associations.requireBySlug(slug);
    const user = await this.users.findById(userId);
    if (!user?.associationId) {
      throw new ForbiddenException(
        'Sua conta não está vinculada a uma associação. Peça ao administrador no console Movly.',
      );
    }
    if (user.associationId !== association.id) {
      throw new ForbiddenException('Você não tem acesso a este portal de associação.');
    }
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

  async getPortalSummary(slug: string): Promise<AssociationPortalSummary> {
    const units = await this.listAssociatePartnerUnits(slug);
    const unitIds = new Set(units.map((u) => u.id));
    const networkIds = new Set(units.map((u) => u.networkId).filter(Boolean));
    const unitsListedInCatalog = units.filter((u) => u.acafAssociate?.listed !== false).length;

    const now = new Date();
    updateStoreIf((draft) => syncAssociateRepasseState(draft, now));
    const store = loadStore();
    const monthKey = currentAssociatePayingLivesMonthPrefix();

    let primaryMembersCount = 0;
    for (const member of store.connectMembers ?? []) {
      if (!member.primaryUnitId || !unitIds.has(member.primaryUnitId)) continue;
      primaryMembersCount += 1;
    }

    return {
      unitCount: units.length,
      networkCount: networkIds.size,
      unitsListedInCatalog,
      primaryMembersCount,
      payingLivesCount: countAssociatePayingLivesForUnits(store, unitIds),
      payingLivesMonthKey: monthKey,
      payingLivesCheckInEventsThisMonth: countCheckInEventsThisMonth(store, unitIds, monthKey),
    };
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
