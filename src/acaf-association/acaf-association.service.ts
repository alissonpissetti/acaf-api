import { Injectable } from '@nestjs/common';
import {
  AssociationPortalService,
  type AssociationAssociateUnitPatch,
} from '../association-portal/association-portal.service';
import type { GymUnit } from '../partner/types';

/** @deprecated Use `AssociationPortalService` com slug `acaf`. */
export type AcafAssociateUnitPatch = AssociationAssociateUnitPatch;

const ACAF_SLUG = 'acaf';

@Injectable()
export class AcafAssociationService {
  constructor(private readonly portal: AssociationPortalService) {}

  async listAssociatePartnerUnits(userId: string) {
    await this.portal.assertPortalAccess(userId, ACAF_SLUG);
    return this.portal.listAssociatePartnerUnits(ACAF_SLUG);
  }

  async getAssociatePartnerUnit(userId: string, unitId: string) {
    await this.portal.assertPortalAccess(userId, ACAF_SLUG);
    return this.portal.getAssociatePartnerUnit(ACAF_SLUG, unitId);
  }

  async patchAssociatePartnerUnit(
    userId: string,
    unitId: string,
    body: AcafAssociateUnitPatch,
  ): Promise<GymUnit> {
    await this.portal.assertPortalAccess(userId, ACAF_SLUG);
    return this.portal.patchAssociatePartnerUnit(ACAF_SLUG, unitId, body);
  }
}
