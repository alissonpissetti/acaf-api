import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AcafAssociateMeta, GymUnit } from '../partner/types';
import { AdminService } from '../partner/admin.service';

export type AcafAssociateUnitPatch = {
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
export class AcafAssociationService {
  constructor(private readonly admin: AdminService) {}

  /** Somente unidades com cadastro de associado movly. (importação da planilha). Demais academias ficam fora deste painel. */
  listAssociatePartnerUnits(): GymUnit[] {
    return this.admin
      .listUnits()
      .filter((u) => u.acafAssociate?.importSource === 'acaf_associates_xlsx');
  }

  getAssociatePartnerUnit(unitId: string): GymUnit {
    const unit = this.admin.listUnits().find((u) => u.id === unitId);
    if (!unit?.acafAssociate || unit.acafAssociate.importSource !== 'acaf_associates_xlsx') {
      throw new NotFoundException('Parceiro associado não encontrado.');
    }
    return unit;
  }

  async patchAssociatePartnerUnit(unitId: string, body: AcafAssociateUnitPatch): Promise<GymUnit> {
    const current = this.getAssociatePartnerUnit(unitId);
    const patch = body.acafAssociate;
    if (!patch || !Object.keys(patch).length) {
      throw new BadRequestException('Informe os campos de acafAssociate para atualizar.');
    }
    const prev = current.acafAssociate!;
    const merged: AcafAssociateMeta = { ...prev, ...patch };
    await this.admin.updateUnit(unitId, { acafAssociate: merged });
    return this.getAssociatePartnerUnit(unitId);
  }
}
