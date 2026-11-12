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

  listAssociatePartnerUnits() {
    return this.portal.listAssociatePartnerUnits(ACAF_SLUG);
  }

  getAssociatePartnerUnit(unitId: string) {
    return this.portal.getAssociatePartnerUnit(ACAF_SLUG, unitId);
  }

  async patchAssociatePartnerUnit(unitId: string, body: AcafAssociateUnitPatch): Promise<GymUnit> {
    return this.portal.patchAssociatePartnerUnit(ACAF_SLUG, unitId, body);
  }
}
