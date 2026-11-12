import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { AccountPayable } from '../finance/account-payable.entity';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { CashEntryStatus } from '../finance/cash-entry.types';
import { Supplier } from '../finance/supplier.entity';
import { NextcloudService } from '../storage/nextcloud.service';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { UsersService } from '../users/users.service';
import { ModalitiesService } from '../modalities/modalities.service';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateCompaniesService } from '../corporate/corporate-companies.service';
import { CorporateEmployeesService } from '../corporate/corporate-employees.service';
import type { Company, CompanyStatus } from '../corporate/company.entity';
import {
  normalizeEvolutionBaseUrl,
  SYSTEM_SETTING_KEYS,
  SystemSettingsService,
} from '../system-settings/system-settings.service';
import { EvolutionInstance } from '../evolution/evolution-instance.entity';
import { getDomain, loadStore, saveDomain, updateStore, updateStoreIf } from './store';
import type {
  AcafAssociateMeta,
  AdminNetwork,
  ApiStore,
  GymUnit,
  NetworkSocialContacts,
} from './types';
import { emptyNetworkSocialContacts } from './types';
import {
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
  type UnitWeeklySchedule,
} from './weeklySchedule';
import { AssociationsService } from '../associations/associations.service';
import { clampPlatformFeePercent } from './platformFeePolicy';
import { recomputeConnectPayouts } from './connectPayout';
import { recalcDailyPassNetForOpenPayout } from './dailyPassSales';
import {
  ACAF_REPASSE_TIERS,
  formatAcafLivesBand,
  resolveAcafRepasseTier,
} from './acafRepassePolicy';
import {
  DAYS_TO_IMPROVE_REPASSE,
  DAYS_TO_REDUCE_REPASSE,
  MAX_NET_CHURN_PERCENT_MONTHLY,
  getAssociateRepasseOverview,
  syncAssociateRepasseState,
} from './associateRepasseHysteresis';
import { currentMonthLabelBr } from './payoutMonth';
import { buildNewUnit, emptyMonthlyPayout } from './unitFactory';
import { isRemotePhotoUrl } from './photoUrls';
import { UnitCoordinatesService } from './unit-coordinates.service';
import { isImportedAssociateMeta } from './associate-meta';
import { cancelCheckInEntry, listCheckInsForUnit, normalizeHolderKey } from './checkIn';
import {
  getPartnerClientDetail,
  type PartnerClientDetail,
} from './partnerClients';
import { PartnerOnboardingService } from '../partner-auth/partner-onboarding.service';

type ConnectPlan = {
  id: string;
  name: string;
  pricePerMonth: number;
  tierIndex: number;
  description: string;
};

type ConnectDomain = {
  schemaVersion: number;
  connectFeePercent: number;
  dailyFeePercent: number;
  connectPlans: ConnectPlan[];
  modalityCatalog: string[];
  [key: string]: unknown;
};

function slugifyNetworkId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  return `net_${slug || 'rede'}`;
}

function normalizeSocial(social?: Partial<NetworkSocialContacts>): NetworkSocialContacts {
  const base = emptyNetworkSocialContacts();
  if (!social) return base;
  return {
    website: social.website?.trim() ?? '',
    instagram: social.instagram?.trim() ?? '',
    facebook: social.facebook?.trim() ?? '',
    whatsapp: social.whatsapp?.trim() ?? '',
    tiktok: social.tiktok?.trim() ?? '',
    youtube: social.youtube?.trim() ?? '',
    linkedin: social.linkedin?.trim() ?? '',
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly storage: NextcloudService,
    private readonly partnerAccess: PartnerAccessService,
    private readonly users: UsersService,
    private readonly modalities: ModalitiesService,
    private readonly corporateAccess: CorporateAccessService,
    private readonly corporateCompanies: CorporateCompaniesService,
    private readonly corporateEmployees: CorporateEmployeesService,
    private readonly unitCoordinates: UnitCoordinatesService,
    @InjectRepository(CommercialLead)
    private readonly commercialLeads: Repository<CommercialLead>,
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
    @InjectRepository(AccountPayable)
    private readonly payables: Repository<AccountPayable>,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(EvolutionInstance)
    private readonly evolutionInstances: Repository<EvolutionInstance>,
    private readonly systemSettings: SystemSettingsService,
    private readonly partnerOnboarding: PartnerOnboardingService,
    private readonly associations: AssociationsService,
  ) {}

  /** Anexa nome/slug da entidade Association nas unidades com `acafAssociate.associationId`. */
  async enrichAdminUnits(units: GymUnit[]): Promise<GymUnit[]> {
    const associationIds = new Set(
      units.map((u) => u.acafAssociate?.associationId).filter((id): id is string => Boolean(id)),
    );
    if (!associationIds.size) {
      return units.map((u) => ({ ...u, associateAssociation: undefined }));
    }
    const rows = await this.associations.listAdmin();
    const byId = new Map(
      rows
        .filter((r) => associationIds.has(r.id))
        .map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug }]),
    );
    return units.map((unit) => {
      const id = unit.acafAssociate?.associationId;
      const associateAssociation = id ? byId.get(id) : undefined;
      return { ...unit, associateAssociation };
    });
  }

  private withUnitCount(network: AdminNetwork): AdminNetwork & { unitCount: number } {
    const store = loadStore();
    return {
      ...network,
      unitCount: store.units.filter((u) => u.networkId === network.id).length,
    };
  }

  private networkUnitIds(store: ApiStore, networkId: string): string[] {
    return store.units.filter((unit) => unit.networkId === networkId).map((unit) => unit.id);
  }

  private countPrimaryMembersForUnits(store: ApiStore, unitIds: string[]): number {
    if (!unitIds.length) return 0;
    const unitIdSet = new Set(unitIds);
    return (store.connectMembers ?? []).filter(
      (member) => member.primaryUnitId && unitIdSet.has(member.primaryUnitId),
    ).length;
  }

  private countPrimaryMembersForUnit(store: ApiStore, unitId: string): number {
    return (store.connectMembers ?? []).filter((member) => member.primaryUnitId === unitId).length;
  }

  private purgeUnitData(store: ApiStore, unitId: string) {
    store.units = store.units.filter((unit) => unit.id !== unitId);
    delete store.payoutsByUnit[unitId];
    delete store.payoutHistoryByUnit[unitId];
    store.students = store.students.filter((student) => student.unitId !== unitId);
    store.checkInLog = store.checkInLog.filter((entry) => entry.unitId !== unitId);
    store.pendingCheckIns = store.pendingCheckIns.filter((entry) => entry.unitId !== unitId);
    store.issuedCodes = store.issuedCodes.filter((entry) => entry.unitId !== unitId);
    store.modalityReservations = (store.modalityReservations ?? []).filter(
      (entry) => entry.unitId !== unitId,
    );
    store.primaryGymChanges = (store.primaryGymChanges ?? []).filter(
      (entry) => entry.toUnitId !== unitId && entry.fromUnitId !== unitId,
    );

    for (const member of store.connectMembers ?? []) {
      if (member.primaryUnitId !== unitId) continue;
      member.primaryUnitId = null;
      member.primaryUnitName = null;
      member.primaryChosenAt = null;
      member.primaryFirstCheckInAt = null;
      member.primaryCheckInsSinceFirst = 0;
    }
  }

  private resetActiveNetworkIfNeeded(store: ApiStore, removedNetworkId: string) {
    if (store.networkId !== removedNetworkId) return;

    const fallbackNetwork = store.networks[0] ?? null;
    if (!fallbackNetwork) {
      store.networkId = '';
      store.networkName = '';
      store.activeUnitId = store.units[0]?.id ?? '';
      return;
    }

    store.networkId = fallbackNetwork.id;
    store.networkName = fallbackNetwork.name;
    store.activeUnitId =
      store.units.find((unit) => unit.networkId === fallbackNetwork.id)?.id ??
      store.units[0]?.id ??
      '';
  }

  private async assertNetworkCanBeRemoved(unitIds: string[]) {
    const store = loadStore();
    const primaryMembers = this.countPrimaryMembersForUnits(store, unitIds);
    if (primaryMembers > 0) {
      throw new BadRequestException(
        `Não é possível remover o parceiro: há ${primaryMembers} usuário(s) com academia principal nesta rede.`,
      );
    }
  }

  private async assertUnitCanBeRemoved(unitId: string) {
    const store = loadStore();
    const primaryMembers = this.countPrimaryMembersForUnit(store, unitId);
    if (primaryMembers > 0) {
      throw new BadRequestException(
        `Não é possível remover a unidade: há ${primaryMembers} usuário(s) com esta unidade como academia principal.`,
      );
    }
  }

  private async commercialOwnerName(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.users.findById(userId);
    return user?.name ?? null;
  }

  private async commercialOwnerNamesByIds(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    await Promise.all(
      unique.map(async (id) => {
        const name = await this.commercialOwnerName(id);
        if (name) map.set(id, name);
      }),
    );
    return map;
  }

  private async companyDtoWithOwner(
    company: Company,
    extras?: { managers?: number; employees?: number },
  ) {
    const dto = this.corporateCompanies.toCompanyDto(company, extras);
    return {
      ...dto,
      commercialOwnerName: await this.commercialOwnerName(company.commercialOwnerUserId),
    };
  }

  private getNetworkOrThrow(id: string): AdminNetwork {
    const store = loadStore();
    const network = store.networks.find((n) => n.id === id);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }
    return network;
  }

  /** Parceiro: só pode editar rede se tiver ao menos uma unidade nela no JWT. */
  assertPartnerCanAccessNetwork(networkId: string, allowedUnitIds: string[]) {
    if (!allowedUnitIds.length) {
      throw new ForbiddenException('Sem acesso.');
    }
    const store = loadStore();
    const allowed = new Set(allowedUnitIds);
    const ok = store.units.some((u) => allowed.has(u.id) && u.networkId === networkId);
    if (!ok) {
      throw new ForbiddenException('Sem permissão para gerir esta rede.');
    }
  }

  getNetworkForPartner(networkId: string, unitIds: string[]) {
    this.assertPartnerCanAccessNetwork(networkId, unitIds);
    const network = this.getNetworkOrThrow(networkId);
    const domain = getDomain() as ConnectDomain;
    return {
      id: network.id,
      name: network.name,
      logoUrl: network.logoUrl ?? null,
      social: network.social ?? emptyNetworkSocialContacts(),
      defaultConnectFeePercent: domain.connectFeePercent,
      defaultDailyFeePercent: domain.dailyFeePercent,
      connectFeePercentOverride: network.connectFeePercentOverride ?? null,
      dailyFeePercentOverride: network.dailyFeePercentOverride ?? null,
    };
  }

  updateNetworkForPartner(
    networkId: string,
    patch: {
      name?: string;
      social?: Partial<NetworkSocialContacts>;
    },
    unitIds: string[],
  ) {
    this.assertPartnerCanAccessNetwork(networkId, unitIds);
    return this.updateNetwork(networkId, patch);
  }

  async uploadNetworkLogoForPartner(networkId: string, file: Express.Multer.File, unitIds: string[]) {
    this.assertPartnerCanAccessNetwork(networkId, unitIds);
    await this.uploadNetworkLogo(networkId, file);
    return this.getNetworkForPartner(networkId, unitIds);
  }
  getOverview() {
    const now = new Date();
    updateStoreIf((draft) => syncAssociateRepasseState(draft, now));
    const store = loadStore();
    const domain = getDomain() as ConnectDomain;
    const ar = getAssociateRepasseOverview(store, now);
    const instantaneousTier = resolveAcafRepasseTier(ar.payingLivesCount);
    return {
      networks: store.networks,
      unitCount: store.units.length,
      planCount: domain.connectPlans?.length ?? 0,
      connectFeePercent: domain.connectFeePercent,
      dailyFeePercent: domain.dailyFeePercent,
      acafPayingLivesCount: ar.payingLivesCount,
      acafRepassePercent: ar.effectiveRepassePercent,
      acafRepasseTierId: ar.effectiveTierId,
      acafInstantaneousRepassePercent: ar.instantaneousRepassePercent,
      acafInstantaneousTierId: ar.instantaneousTierId,
      acafEffectiveRepasseSinceDate: ar.effectiveSinceDate,
      acafEffectiveRepasseUpdatedAt: ar.effectiveUpdatedAt,
      acafLastSnapshotDate: ar.lastSnapshotDate,
      acafNetChurnRolling: {
        maxNetChurnPercentAllowed: MAX_NET_CHURN_PERCENT_MONTHLY,
        percent: ar.netChurnRolling.netChurnPercent,
        referenceMonthKey: ar.netChurnRolling.referenceMonthKey || null,
        startDate: ar.netChurnRolling.startDate,
        endDate: ar.netChurnRolling.endDate,
        startCount: ar.netChurnRolling.startCount,
        endCount: ar.netChurnRolling.endCount,
        insufficientData: ar.netChurnRolling.insufficientData,
      },
      acafRepassePersistence: {
        daysRequiredToIncreaseRepasse: DAYS_TO_IMPROVE_REPASSE,
        daysRequiredToDecreaseRepasse: DAYS_TO_REDUCE_REPASSE,
        maxNetChurnPercentMonthly: MAX_NET_CHURN_PERCENT_MONTHLY,
        upgradeToBetterTier: ar.upgradeProgress
          ? {
              targetTierId: ar.upgradeProgress.targetTierId,
              targetRepassePercent: ar.upgradeProgress.targetRepassePercent,
              consecutiveDays: ar.upgradeProgress.consecutiveDays,
              requiredConsecutiveDays: ar.upgradeProgress.requiredConsecutiveDays,
              daysRemaining: ar.upgradeProgress.daysRemaining,
              blockedByNetChurn: ar.upgradeProgress.blockedByNetChurn,
              netChurnPercent: ar.upgradeProgress.netChurnPercent,
              churnReferenceMonthKey: ar.upgradeProgress.churnReferenceMonthKey,
            }
          : null,
        downgradeToWorseTier: ar.downgradeProgress
          ? {
              targetTierId: ar.downgradeProgress.targetTierId,
              targetRepassePercent: ar.downgradeProgress.targetRepassePercent,
              consecutiveDays: ar.downgradeProgress.consecutiveDays,
              requiredConsecutiveDays: ar.downgradeProgress.requiredConsecutiveDays,
              daysRemaining: ar.downgradeProgress.daysRemaining,
              blockedByNetChurn: ar.downgradeProgress.blockedByNetChurn,
              netChurnPercent: ar.downgradeProgress.netChurnPercent,
              churnReferenceMonthKey: ar.downgradeProgress.churnReferenceMonthKey,
            }
          : null,
      },
      acafRepasseTierMismatch: instantaneousTier.id !== ar.effectiveTierId,
      acafRepasseTiers: ACAF_REPASSE_TIERS.map((t) => ({
        id: t.id,
        min: t.min,
        max: t.max,
        repassePercent: t.repassePercent,
        bandLabel: formatAcafLivesBand(t),
        isEffectiveTier: t.id === ar.effectiveTierId,
        isInstantaneousTier: t.id === instantaneousTier.id,
      })),
      acafOverviewComputedAt: now.toISOString(),
    };
  }

  async listNetworks() {
    const store = loadStore();
    const owners = await this.commercialOwnerNamesByIds(
      store.networks.map((network) => network.commercialOwnerUserId),
    );
    const pendingInviteNetworkIds = await this.partnerOnboarding.networkIdsWithPendingInvite();
    const onboardingEmailMeta = await this.partnerOnboarding.listOnboardingEmailMetaByNetwork(
      store.networks,
      store,
    );

    return Promise.all(
      store.networks.map(async (network) => {
        const unitIds = this.networkUnitIds(store, network.id);
        const withCount = this.withUnitCount(network);
        const partnerUserCount = await this.partnerAccess.countLinkedUsersForUnits(unitIds);
        const hasPartnerUser = partnerUserCount > 0;
        const invitePending = pendingInviteNetworkIds.has(network.id);
        const emailMeta = onboardingEmailMeta.get(network.id);
        return {
          ...withCount,
          primaryMemberCount: this.countPrimaryMembersForUnits(store, unitIds),
          partnerUserCount,
          hasPartnerUser,
          invitePending,
          commercialOwnerName: network.commercialOwnerUserId
            ? owners.get(network.commercialOwnerUserId) ?? null
            : null,
          onboardingInviteEmail: emailMeta?.onboardingInviteEmail ?? null,
          onboardingInviteEmailSource: emailMeta?.onboardingInviteEmailSource ?? null,
          onboardingInviteEmailSentToday: emailMeta?.onboardingInviteEmailSentToday ?? false,
          partnerInviteKind: hasPartnerUser ? 'team' : 'onboarding',
        };
      }),
    );
  }

  /**
   * Nova rede com um único parceiro — copia logo e links da rede de origem (mantém aparência no app).
   */
  private createStandaloneNetworkFromTemplate(
    store: ApiStore,
    unitDisplayName: string,
    template: AdminNetwork,
  ): AdminNetwork {
    let trimmed = unitDisplayName.trim();
    if (!trimmed) trimmed = 'Parceiro';
    let id = slugifyNetworkId(trimmed);
    if (store.networks.some((n) => n.id === id)) {
      id = `${id}_${Date.now().toString(36).slice(-4)}`;
    }
    const network: AdminNetwork = {
      id,
      name: trimmed,
      logoUrl: template.logoUrl ?? null,
      social: template.social ? normalizeSocial(template.social) : emptyNetworkSocialContacts(),
      commercialOwnerUserId: template.commercialOwnerUserId ?? null,
      createdFromAdmin: true,
    };
    store.networks.push(network);
    return network;
  }

  async createNetwork(
    name: string,
    social?: Partial<NetworkSocialContacts>,
    commercialOwnerUserId?: string,
  ) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Informe o nome da rede.');
    }
    let created: AdminNetwork | null = null;
    updateStore((s) => {
      let id = slugifyNetworkId(trimmed);
      if (s.networks.some((n) => n.id === id)) {
        id = `${id}_${Date.now().toString(36).slice(-4)}`;
      }
      created = {
        id,
        name: trimmed,
        logoUrl: null,
        social: normalizeSocial(social),
        commercialOwnerUserId: commercialOwnerUserId ?? null,
        createdFromAdmin: true,
      };
      s.networks.push(created);
    });
    const network = this.withUnitCount(created!);
    return {
      ...network,
      commercialOwnerName: await this.commercialOwnerName(network.commercialOwnerUserId),
    };
  }

  updateNetwork(
    id: string,
    patch: {
      name?: string;
      logoUrl?: string | null;
      social?: Partial<NetworkSocialContacts>;
      connectFeePercentOverride?: number | null;
      dailyFeePercentOverride?: number | null;
      partnerContactEmail?: string | null;
    },
  ) {
    const current = loadStore();
    if (!current.networks.some((n) => n.id === id)) {
      throw new NotFoundException('Rede não encontrada.');
    }

    if (patch.name != null) {
      const trimmed = patch.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Informe o nome da rede.');
      }
    }

    let normalizedPartnerContactEmail: string | undefined;
    if (patch.partnerContactEmail !== undefined) {
      const raw = patch.partnerContactEmail;
      if (raw === null || String(raw).trim() === '') {
        normalizedPartnerContactEmail = undefined;
      } else {
        const normalized = String(raw).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          throw new BadRequestException('E-mail responsável do parceiro inválido.');
        }
        normalizedPartnerContactEmail = normalized;
      }
    }

    let updated: AdminNetwork | null = null;
    updateStore((s) => {
      const network = s.networks.find((n) => n.id === id)!;
      if (patch.name != null) {
        network.name = patch.name.trim();
        if (s.networkId === id) {
          s.networkName = network.name;
        }
      }
      if (patch.logoUrl !== undefined) {
        network.logoUrl = patch.logoUrl;
      }
      if (patch.social !== undefined) {
        network.social = normalizeSocial(patch.social);
      }
      if (patch.connectFeePercentOverride !== undefined) {
        network.connectFeePercentOverride =
          patch.connectFeePercentOverride === null
            ? undefined
            : clampPlatformFeePercent(patch.connectFeePercentOverride);
      }
      if (patch.dailyFeePercentOverride !== undefined) {
        network.dailyFeePercentOverride =
          patch.dailyFeePercentOverride === null
            ? undefined
            : clampPlatformFeePercent(patch.dailyFeePercentOverride);
      }
      if (patch.partnerContactEmail !== undefined) {
        network.partnerContactEmail = normalizedPartnerContactEmail;
      }
      updated = { ...network };

      recomputeConnectPayouts(s);
      for (const u of s.units) {
        if (u.networkId === id) {
          recalcDailyPassNetForOpenPayout(s, u.id);
        }
      }
    });

    return this.withUnitCount(updated!);
  }

  async deleteNetwork(id: string) {
    const current = loadStore();
    const network = current.networks.find((item) => item.id === id);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }

    const unitIds = this.networkUnitIds(current, id);
    for (const unitId of unitIds) {
      await this.partnerAccess.removeAccessForUnit(unitId);
    }
    await this.assertNetworkCanBeRemoved(unitIds);

    updateStore((store) => {
      for (const unitId of unitIds) {
        this.purgeUnitData(store, unitId);
      }
      store.networks = store.networks.filter((item) => item.id !== id);
      this.resetActiveNetworkIfNeeded(store, id);
    });

    return { ok: true };
  }

  /**
   * Une várias redes numa só: todas as unidades passam para a rede `keeperNetworkId`;
   * as demais entradas de rede são removidas. Mantém nome, logo e redes sociais da rede mantida.
   */
  async mergeNetworks(keeperNetworkId: string, mergeNetworkIds: string[]): Promise<AdminNetwork & { unitCount: number }> {
    const unique = [...new Set(mergeNetworkIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length < 2) {
      throw new BadRequestException('Selecione pelo menos duas redes para agrupar.');
    }
    const keeperId = keeperNetworkId.trim();
    if (!unique.includes(keeperId)) {
      throw new BadRequestException('A rede a manter precisa estar entre as selecionadas.');
    }

    const snapshot = loadStore();
    const keeper = snapshot.networks.find((n) => n.id === keeperId);
    if (!keeper) {
      throw new NotFoundException('Rede a manter não encontrada.');
    }
    for (const id of unique) {
      if (!snapshot.networks.some((n) => n.id === id)) {
        throw new NotFoundException(`Rede não encontrada: ${id}.`);
      }
    }

    const others = unique.filter((id) => id !== keeperId);

    updateStore((store) => {
      const k = store.networks.find((n) => n.id === keeperId)!;
      for (const id of others) {
        const unitIds = this.networkUnitIds(store, id);
        for (const unitId of unitIds) {
          const unit = store.units.find((u) => u.id === unitId);
          if (unit) unit.networkId = keeperId;
        }
      }

      const removedSet = new Set(others);
      store.networks = store.networks.filter((n) => !removedSet.has(n.id));

      if (removedSet.has(store.networkId) || !store.networks.some((n) => n.id === store.networkId)) {
        store.networkId = k.id;
        store.networkName = k.name;
        const firstUnit = store.units.find((u) => u.networkId === k.id);
        if (firstUnit) store.activeUnitId = firstUnit.id;
      }
    });

    const after = loadStore();
    const merged = after.networks.find((n) => n.id === keeperId)!;
    return this.withUnitCount({ ...merged });
  }

  /**
   * Para cada unidade selecionada, cria uma nova rede (nome = nome da unidade) e move a unidade para ela.
   * Copia logo e redes sociais da rede de origem. Remove a rede de origem se ficar sem unidades.
   */
  async detachUnitsToOwnNetworks(
    sourceNetworkId: string,
    unitIds: string[],
  ): Promise<{
    created: { networkId: string; networkName: string; unitId: string }[];
    removedSourceNetwork: boolean;
  }> {
    const srcId = sourceNetworkId.trim();
    const uniqueUnitIds = [...new Set(unitIds.map((id) => id.trim()).filter(Boolean))];
    if (!srcId) {
      throw new BadRequestException('Informe a rede de origem.');
    }
    if (!uniqueUnitIds.length) {
      throw new BadRequestException('Selecione ao menos uma unidade.');
    }

    const snapshot = loadStore();
    const template = snapshot.networks.find((n) => n.id === srcId);
    if (!template) {
      throw new NotFoundException('Rede de origem não encontrada.');
    }

    for (const uid of uniqueUnitIds) {
      const u = snapshot.units.find((unit) => unit.id === uid);
      if (!u) {
        throw new NotFoundException(`Unidade não encontrada: ${uid}.`);
      }
      if (u.networkId !== srcId) {
        throw new BadRequestException(
          `A unidade "${u.unitName}" não pertence à rede atual (origem: ${srcId}).`,
        );
      }
    }

    const created: { networkId: string; networkName: string; unitId: string }[] = [];
    let removedSourceNetwork = false;

    updateStore((store) => {
      const tpl = store.networks.find((n) => n.id === srcId);
      if (!tpl) return;

      for (const uid of uniqueUnitIds) {
        const unit = store.units.find((u) => u.id === uid);
        if (!unit) continue;
        const displayName = unit.unitName.trim() || tpl.name.trim() || 'Parceiro';
        const newNet = this.createStandaloneNetworkFromTemplate(store, displayName, tpl);
        unit.networkId = newNet.id;
        created.push({
          networkId: newNet.id,
          networkName: newNet.name,
          unitId: unit.id,
        });
      }

      const stillInSource = store.units.some((u) => u.networkId === srcId);
      if (!stillInSource) {
        store.networks = store.networks.filter((n) => n.id !== srcId);
        removedSourceNetwork = true;
        this.resetActiveNetworkIfNeeded(store, srcId);
      }
    });

    return { created, removedSourceNetwork };
  }

  /**
   * Remove em lote redes criadas pela importação ACAF (`net_acaf_*`, inclusive `net_acaf_grp_*`).
   * Mesma regra de `deleteNetwork` para academia principal (app); vínculos de equipe parceira
   * são removidos automaticamente ao excluir.
   */
  async deleteAllAcafImportedNetworks(): Promise<{
    candidates: number;
    removed: number;
    skipped: { id: string; name: string; reason: string }[];
  }> {
    const store = loadStore();
    const targets = store.networks.filter((n) => n.id.startsWith('net_acaf_'));
    const skipped: { id: string; name: string; reason: string }[] = [];
    let removed = 0;

    for (const network of targets) {
      try {
        await this.deleteNetwork(network.id);
        removed += 1;
      } catch (err) {
        const reason =
          err instanceof BadRequestException || err instanceof NotFoundException
            ? String(err.message)
            : err instanceof Error
              ? err.message
              : 'Falha ao remover.';
        skipped.push({ id: network.id, name: network.name, reason });
      }
    }

    return {
      candidates: targets.length,
      removed,
      skipped,
    };
  }

  async uploadNetworkLogo(id: string, file: Express.Multer.File) {
    this.getNetworkOrThrow(id);
    const { publicUrl } = await this.storage.uploadNetworkLogo(id, file);
    return this.updateNetwork(id, { logoUrl: publicUrl });
  }

  private getUnitOrThrow(unitId: string): GymUnit {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada.');
    }
    return unit;
  }

  private findUnitInList(units: GymUnit[], unitId: string) {
    return units.find((u) => u.id === unitId) ?? null;
  }

  async uploadUnitHeroPhoto(unitId: string, file: Express.Multer.File) {
    this.getUnitOrThrow(unitId);
    const { publicUrl } = await this.storage.uploadUnitPhoto(unitId, file, 'hero');
    updateStore((s) => {
      const unit = s.units.find((u) => u.id === unitId);
      if (!unit) return;
      unit.heroPhotoDataUrl = publicUrl;
    });
    return this.findUnitInList(this.listUnits(), unitId);
  }

  async uploadUnitGalleryPhotos(unitId: string, files: Express.Multer.File[]) {
    const unit = this.getUnitOrThrow(unitId);
    const maxGallery = 8;
    const remaining = maxGallery - unit.galleryPhotoDataUrls.length;
    if (remaining <= 0) {
      throw new BadRequestException('A galeria já atingiu o limite de 8 fotos.');
    }
    const batch = files.slice(0, remaining);
    if (!batch.length) {
      throw new BadRequestException('Envie ao menos uma foto.');
    }

    const uploaded: string[] = [];
    for (const file of batch) {
      const fileName = `gallery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const { publicUrl } = await this.storage.uploadUnitPhoto(unitId, file, fileName);
      uploaded.push(publicUrl);
    }

    updateStore((s) => {
      const current = s.units.find((u) => u.id === unitId);
      if (!current) return;
      current.galleryPhotoDataUrls = [...current.galleryPhotoDataUrls, ...uploaded].slice(0, maxGallery);
    });

    return this.findUnitInList(this.listUnits(), unitId);
  }

  removeUnitHeroPhoto(unitId: string) {
    this.getUnitOrThrow(unitId);
    updateStore((s) => {
      const unit = s.units.find((u) => u.id === unitId);
      if (!unit) return;
      unit.heroPhotoDataUrl = null;
    });
    return this.findUnitInList(this.listUnits(), unitId);
  }

  setUnitHeroFromGallery(unitId: string, index: number) {
    const unit = this.getUnitOrThrow(unitId);
    const url = unit.galleryPhotoDataUrls[index];
    if (!url) {
      throw new BadRequestException('Foto não encontrada na galeria.');
    }
    updateStore((s) => {
      const current = s.units.find((u) => u.id === unitId);
      if (!current) return;
      current.heroPhotoDataUrl = url;
    });
    return this.findUnitInList(this.listUnits(), unitId);
  }

  removeUnitGalleryPhoto(unitId: string, index: number) {
    const unit = this.getUnitOrThrow(unitId);
    if (index < 0 || index >= unit.galleryPhotoDataUrls.length) {
      throw new BadRequestException('Foto não encontrada na galeria.');
    }
    const removedUrl = unit.galleryPhotoDataUrls[index];
    updateStore((s) => {
      const current = s.units.find((u) => u.id === unitId);
      if (!current) return;
      current.galleryPhotoDataUrls = current.galleryPhotoDataUrls.filter((_, i) => i !== index);
      if (current.heroPhotoDataUrl === removedUrl) {
        current.heroPhotoDataUrl = null;
      }
    });
    return this.findUnitInList(this.listUnits(), unitId);
  }

  listUnits(networkId?: string) {
    const store = loadStore();
    const networkMap = new Map(store.networks.map((n) => [n.id, n.name]));
    let units = store.units;
    if (networkId) {
      units = units.filter((u) => u.networkId === networkId);
    }
    return units.map((unit) => ({
      ...unit,
      networkName: networkMap.get(unit.networkId) ?? unit.networkId,
      primaryMemberCount: this.countPrimaryMembersForUnit(store, unit.id),
    }));
  }

  async createUnit(body: {
    networkId: string;
    unitName: string;
    zip?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state?: string;
    openHours?: string;
    weeklySchedule?: UnitWeeklySchedule;
    description?: string;
  }) {
    const networkId = body.networkId?.trim();
    const unitName = body.unitName?.trim() ?? '';
    const neighborhood = body.neighborhood?.trim() ?? '';
    const city = body.city?.trim() ?? '';
    const address = body.address?.trim() ?? '';
    const zip = body.zip?.replace(/\D/g, '') ?? '';
    if (!networkId || !unitName || !neighborhood || !city || !address || zip.length !== 8) {
      throw new BadRequestException('Informe rede, nome, CEP, logradouro, bairro e cidade.');
    }

    const current = loadStore();
    if (!current.networks.some((n) => n.id === networkId)) {
      throw new NotFoundException('Rede não encontrada.');
    }

    const weeklySchedule = normalizeWeeklySchedule(body.weeklySchedule);

    let unit = buildNewUnit(current, {
      networkId,
      unitName,
      neighborhood,
      city,
      zip,
      address,
      number: body.number,
      complement: body.complement,
      state: body.state,
      weeklySchedule,
      description: body.description,
    });
    unit = await this.unitCoordinates.applyToUnit(unit);

    updateStore((s) => {
      s.units.push(unit);
      const monthLabel = Object.values(s.payoutsByUnit)[0]?.monthLabel ?? currentMonthLabelBr();
      s.payoutsByUnit[unit.id] = emptyMonthlyPayout(monthLabel);
      s.payoutHistoryByUnit[unit.id] = [s.payoutsByUnit[unit.id]];
    });
    return await this.enrichAdminUnits(this.listUnits(networkId));
  }

  async updateUnit(unitId: string, patch: Partial<GymUnit>) {
    const current = loadStore();
    const idx = current.units.findIndex((u) => u.id === unitId);
    if (idx < 0) {
      throw new NotFoundException('Unidade não encontrada.');
    }
    if (patch.networkId && !current.networks.some((n) => n.id === patch.networkId)) {
      throw new NotFoundException('Rede não encontrada.');
    }

    const before = current.units[idx];
    const {
      heroPhotoDataUrl,
      galleryPhotoDataUrls,
      acafAssociate: acafPatch,
      connectFeePercentOverride,
      dailyFeePercentOverride,
      ...rest
    } = patch;
    let next: GymUnit = { ...before, ...rest, id: unitId };

    if (connectFeePercentOverride !== undefined) {
      next.connectFeePercentOverride =
        connectFeePercentOverride === null ? undefined : clampPlatformFeePercent(connectFeePercentOverride);
    }
    if (dailyFeePercentOverride !== undefined) {
      next.dailyFeePercentOverride =
        dailyFeePercentOverride === null ? undefined : clampPlatformFeePercent(dailyFeePercentOverride);
    }

    if (acafPatch !== undefined) {
      const prev = before.acafAssociate;
      if (!prev || !isImportedAssociateMeta(prev)) {
        throw new BadRequestException('Esta unidade não possui dados de importação movly. para editar.');
      }
      const cnpjLocked = prev.cnpj;
      const {
        cnpj: _ignoredCnpj,
        associationId: patchAssociationId,
        importSource: _ignoredSource,
        importedAt: patchImportedAt,
        ...acafRest
      } = acafPatch as Partial<AcafAssociateMeta> & { cnpj?: string };
      let nextAssociationId = prev.associationId;
      if (patchAssociationId !== undefined) {
        const raw = patchAssociationId == null ? '' : String(patchAssociationId).trim();
        if (!raw) {
          nextAssociationId = undefined;
        } else {
          const row = await this.associations.getById(raw);
          if (!row) {
            throw new BadRequestException('Associação (agrupador) não encontrada.');
          }
          nextAssociationId = row.id;
        }
      }
      const listed =
        acafRest.listed !== undefined ? acafRest.listed : (prev.listed ?? true);
      next.acafAssociate = {
        ...prev,
        ...acafRest,
        cnpj: cnpjLocked,
        associationId: nextAssociationId,
        importSource: prev.importSource,
        importedAt:
          patchImportedAt !== undefined && patchImportedAt !== null
            ? String(patchImportedAt)
            : prev.importedAt,
        listed,
      };
    }
    if (heroPhotoDataUrl !== undefined && isRemotePhotoUrl(heroPhotoDataUrl)) {
      next.heroPhotoDataUrl = heroPhotoDataUrl;
    }
    if (
      galleryPhotoDataUrls !== undefined &&
      galleryPhotoDataUrls.every((url) => isRemotePhotoUrl(url))
    ) {
      next.galleryPhotoDataUrls = galleryPhotoDataUrls;
    }
    if (patch.weeklySchedule) {
      next.weeklySchedule = normalizeWeeklySchedule(patch.weeklySchedule);
      next.openHours = formatOpenHoursSummary(next.weeklySchedule);
    }
    next = await this.unitCoordinates.applyIfNeeded(before, next);

    updateStore((s) => {
      const i = s.units.findIndex((u) => u.id === unitId);
      if (i < 0) return;
      s.units[i] = next;
      recomputeConnectPayouts(s);
      recalcDailyPassNetForOpenPayout(s, unitId);
    });

    return await this.enrichAdminUnits(this.listUnits());
  }

  listUnitCheckIns(unitId: string, todayOnly = true) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada.');
    }
    return {
      unitId,
      unitName: unit.unitName,
      entries: listCheckInsForUnit(store, unitId, { todayOnly, limit: 50 }),
    };
  }

  cancelUnitCheckIn(unitId: string, entryId: string) {
    const current = loadStore();
    const unit = current.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada.');
    }

    let removed: import('./types').CheckInLogEntry | null = null;
    updateStore((s) => {
      removed = cancelCheckInEntry(s, entryId, unitId);
    });

    if (!removed) {
      throw new NotFoundException('Check-in não encontrado nesta unidade.');
    }

    return { ok: true, removed };
  }

  async deleteUnit(unitId: string) {
    const current = loadStore();
    const unit = current.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada.');
    }

    await this.partnerAccess.removeAccessForUnit(unitId);
    await this.assertUnitCanBeRemoved(unitId);

    const networkId = unit.networkId;

    updateStore((s) => {
      this.purgeUnitData(s, unitId);
      if (s.activeUnitId === unitId) {
        const fallback =
          s.units.find((u) => u.networkId === networkId) ?? s.units[0] ?? null;
        if (fallback) {
          s.activeUnitId = fallback.id;
          s.networkId = fallback.networkId;
          const network = s.networks.find((n) => n.id === fallback.networkId);
          if (network) s.networkName = network.name;
        } else {
          s.activeUnitId = '';
        }
      }
    });

    return { ok: true, networkId };
  }

  searchUsers(query: string) {
    return this.users.search(query);
  }

  /** @deprecated Use searchUsers */
  searchPlatformUsers(query: string) {
    return this.searchUsers(query);
  }

  createPlatformUser(body: {
    name: string;
    email: string;
    cpf: string;
    password: string;
  }) {
    return this.users.createWithPassword(body);
  }

  listUnitPartnerUsers(unitId: string) {
    this.getUnitOrThrow(unitId);
    return this.partnerAccess.listUnitPartnerUsers(unitId);
  }

  async addUnitPartnerUser(
    unitId: string,
    body: {
      userId?: string;
      name?: string;
      email?: string;
      cpf?: string;
      password?: string;
    },
  ) {
    this.getUnitOrThrow(unitId);

    if (body.userId) {
      return this.partnerAccess.linkUserToUnit(unitId, body.userId);
    }

    if (!body.name || !body.email || !body.cpf || !body.password) {
      throw new BadRequestException(
        'Informe userId ou os dados para cadastrar um novo usuário (nome, e-mail, CPF e senha).',
      );
    }

    const created = await this.users.createWithPassword({
      name: body.name,
      email: body.email,
      cpf: body.cpf,
      password: body.password,
    });
    return this.partnerAccess.linkUserToUnit(unitId, created.id);
  }

  async removeUnitPartnerUser(unitId: string, userId: string) {
    this.getUnitOrThrow(unitId);
    await this.partnerAccess.unlinkUserFromUnit(unitId, userId);
    return { ok: true };
  }

  async getConnectDomain(): Promise<ConnectDomain> {
    const domain = getDomain() as ConnectDomain;
    const snapshot = await this.systemSettings.getAdminSnapshot();
    domain.connectFeePercent = snapshot.connectFeePercent;
    domain.dailyFeePercent = snapshot.dailyFeePercent;
    domain.evolutionApiBaseUrl = snapshot.evolutionApiBaseUrl;
    domain.evolutionApiKeySet = snapshot.evolutionApiKeySet;
    domain.evolutionApiKey = snapshot.evolutionApiKeySet ? '••••••••' : '';
    domain.apiPublicBaseUrl = snapshot.apiPublicBaseUrl;
    domain.evolutionWebhookUrl = snapshot.evolutionWebhookUrl;
    domain.modalityCatalog = await this.modalities.listActiveNames();
    return domain;
  }

  async updateConnectDomain(body: {
    connectFeePercent?: number;
    dailyFeePercent?: number;
    connectPlans?: ConnectPlan[];
    evolutionApiBaseUrl?: string;
    evolutionApiKey?: string;
    apiPublicBaseUrl?: string;
  }) {
    const domain = { ...(getDomain() as ConnectDomain) };

    if (body.connectFeePercent != null) {
      await this.systemSettings.set('connectFeePercent', String(body.connectFeePercent));
      domain.connectFeePercent = body.connectFeePercent;
    }
    if (body.dailyFeePercent != null) {
      await this.systemSettings.set('dailyFeePercent', String(body.dailyFeePercent));
      domain.dailyFeePercent = body.dailyFeePercent;
    }
    if (body.connectPlans) {
      domain.connectPlans = normalizeConnectPlans(body.connectPlans);
    }
    if (body.evolutionApiBaseUrl !== undefined) {
      const value = normalizeEvolutionBaseUrl(String(body.evolutionApiBaseUrl ?? ''));
      await this.systemSettings.set('evolutionApiBaseUrl', value);
      domain.evolutionApiBaseUrl = value;
      await this.evolutionInstances
        .createQueryBuilder()
        .update(EvolutionInstance)
        .set({ baseUrl: value })
        .execute();
    }
    if (body.apiPublicBaseUrl !== undefined) {
      const raw = String(body.apiPublicBaseUrl ?? '').trim().replace(/\/+$/, '');
      if (raw) {
        normalizeEvolutionBaseUrl(raw);
      }
      await this.systemSettings.set(SYSTEM_SETTING_KEYS.apiPublicBaseUrl, raw);
      domain.apiPublicBaseUrl = raw;
    }
    if (body.evolutionApiKey !== undefined) {
      const trimmed = String(body.evolutionApiKey ?? '').trim();
      if (!trimmed) {
        throw new BadRequestException('Informe a chave de integração WhatsApp.');
      }
      await this.systemSettings.set('evolutionApiKey', trimmed);
      await this.evolutionInstances
        .createQueryBuilder()
        .update(EvolutionInstance)
        .set({ apiKey: trimmed })
        .execute();
    }
    if (body.connectPlans) {
      try {
        saveDomain(domain);
      } catch {
        /* planos permanecem no JSON */
      }
    }
    return this.getConnectDomain();
  }

  listModalities() {
    return this.modalities.findAll();
  }

  createModality(name: string) {
    return this.modalities.create(name);
  }

  updateModality(
    id: string,
    patch: { name?: string; sortOrder?: number; active?: boolean },
  ) {
    return this.modalities.update(id, patch);
  }

  deleteModality(id: string) {
    return this.modalities.remove(id);
  }

  reorderModalities(ids: string[]) {
    return this.modalities.reorder(ids);
  }

  async listCompanies(status?: CompanyStatus) {
    const rows = await this.corporateAccess.listCompanies(status);
    const result = [];
    for (const company of rows) {
      const managers = await this.corporateAccess.listCompanyManagers(company.id);
      const employees = await this.corporateEmployees.listEmployees(company.id);
      result.push(
        await this.companyDtoWithOwner(company, {
          managers: managers.length,
          employees: employees.length,
        }),
      );
    }
    return result;
  }

  async getCompany(id: string) {
    const company = await this.corporateAccess.findCompanyById(id);
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const managers = await this.corporateAccess.listCompanyManagers(id);
    const employees = await this.corporateEmployees.listEmployees(id);
    return {
      ...(await this.companyDtoWithOwner(company, {
        managers: managers.length,
        employees: employees.length,
      })),
      managers,
      employees,
    };
  }

  async updateCompanyStatus(id: string, status: CompanyStatus, actingUserId?: string) {
    const company = await this.corporateAccess.updateCompanyStatus(id, status, actingUserId);
    return this.companyDtoWithOwner(company);
  }

  async createCompany(
    body: {
      legalName: string;
      tradeName?: string;
      cnpj?: string;
      email?: string;
      phone?: string;
    },
    commercialOwnerUserId?: string,
  ) {
    const created = await this.corporateCompanies.createByAdmin({
      ...body,
      commercialOwnerUserId,
    });
    const company = await this.corporateAccess.findCompanyById(created.id);
    if (!company) throw new NotFoundException('Empresa não encontrada após cadastro.');
    return this.companyDtoWithOwner(company, { managers: 0, employees: 0 });
  }

  addCompanyManager(companyId: string, userId: string) {
    return this.corporateAccess.linkUserToCompany(companyId, userId);
  }

  removeCompanyManager(companyId: string, userId: string) {
    return this.corporateAccess.unlinkUserFromCompany(companyId, userId);
  }

  async deleteCompany(id: string) {
    const company = await this.corporateAccess.findCompanyById(id);
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const employees = await this.corporateEmployees.listEmployees(id);

    await this.assertCompanyHasNoFinanceEntries(company);

    await this.commercialLeads.update({ convertedCompanyId: id }, { convertedCompanyId: null });
    await this.corporateEmployees.removeAllForCompany(id);
    await this.corporateAccess.deleteCompany(id);
    return { ok: true, removedEmployees: employees.length };
  }

  async removeCompanyEmployee(companyId: string, employeeId: string) {
    const company = await this.corporateAccess.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const employees = await this.corporateEmployees.listEmployees(companyId);
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
      throw new NotFoundException('Colaborador não encontrado nesta empresa.');
    }

    this.assertEmployeesHaveNoCheckIns([employee]);
    await this.corporateEmployees.removeEmployee(companyId, employeeId);
    return { ok: true };
  }

  async getCompanyEmployeeProfile(companyId: string, employeeId: string) {
    const company = await this.corporateAccess.findCompanyById(companyId);
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const employees = await this.corporateEmployees.listEmployees(companyId);
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
      throw new NotFoundException('Colaborador não encontrado nesta empresa.');
    }

    const store = loadStore();
    const holderKey = normalizeHolderKey(employee.name);
    const unitIds = store.units.map((unit) => unit.id);
    const client =
      getPartnerClientDetail(store, unitIds, holderKey, 'all') ??
      this.emptyClientProfile(employee.name, holderKey);

    if (!client.email && employee.email) client.email = employee.email;
    if (!client.cpf && employee.cpf) client.cpf = employee.cpf;
    if (!client.companyName) {
      client.companyName = company.tradeName || company.legalName;
    }

    const studentRecords = client.studentRecords.map((student) => ({
      ...student,
      unitName:
        store.units.find((unit) => unit.id === student.unitId)?.unitName?.trim() ||
        student.unitId,
    }));

    return {
      employee,
      company: {
        id: company.id,
        tradeName: company.tradeName,
        legalName: company.legalName,
      },
      client: {
        ...client,
        studentRecords,
      },
    };
  }

  private emptyClientProfile(name: string, holderKey: string): PartnerClientDetail {
    return {
      holderKey,
      name: name.trim(),
      isPrimaryMember: false,
      totalCheckIns: 0,
      checkInsThisMonth: 0,
      dailyPassesTotal: 0,
      dailyPassesThisMonth: 0,
      relationship: 'visitor',
      checkIns: [],
      primaryHistory: { changes: [] },
      studentRecords: [],
    };
  }

  private async assertCompanyHasNoFinanceEntries(company: Company): Promise<void> {
    const activeEntries = { status: Not(CashEntryStatus.CANCELLED) };

    const receivableCount = await this.receivables.count({
      where: {
        payerKind: 'company',
        payerRefId: company.id,
        ...activeEntries,
      },
    });

    let payableCount = 0;
    const companyDocument = company.cnpj?.replace(/\D/g, '') ?? '';
    if (companyDocument) {
      const supplierRows = await this.suppliers.find({
        where: { document: companyDocument },
        select: ['id'],
      });
      const supplierIds = supplierRows.map((row) => row.id);
      if (supplierIds.length) {
        payableCount = await this.payables.count({
          where: {
            supplierId: In(supplierIds),
            ...activeEntries,
          },
        });
      }
    }

    if (receivableCount === 0 && payableCount === 0) return;

    const parts: string[] = [];
    if (receivableCount > 0) {
      parts.push(`${receivableCount} conta(s) a receber`);
    }
    if (payableCount > 0) {
      parts.push(`${payableCount} conta(s) a pagar`);
    }

    throw new BadRequestException(
      `Não é possível excluir a empresa: existem ${parts.join(' e ')} vinculadas. Remova ou cancele os lançamentos no financeiro antes de excluir.`,
    );
  }

  private assertEmployeesHaveNoCheckIns(
    employees: { name: string }[],
  ): void {
    const holderKeys = new Map<string, string>();
    for (const employee of employees) {
      const name = employee.name?.trim();
      if (!name) continue;
      holderKeys.set(normalizeHolderKey(name), name);
    }
    if (!holderKeys.size) return;

    const store = loadStore();

    for (const member of store.connectMembers ?? []) {
      if (!holderKeys.has(member.holderKey)) continue;
      if (member.primaryFirstCheckInAt || member.primaryCheckInsSinceFirst > 0) {
        const employeeName = holderKeys.get(member.holderKey) ?? member.holderName;
        throw new BadRequestException(
          `Não é possível remover a empresa: o colaborador ${employeeName} possui check-in cadastrado.`,
        );
      }
    }

    for (const entry of store.checkInLog ?? []) {
      const key = normalizeHolderKey(entry.holderName);
      if (!holderKeys.has(key)) continue;
      const employeeName = holderKeys.get(key) ?? entry.holderName;
      throw new BadRequestException(
        `Não é possível remover a empresa: o colaborador ${employeeName} possui check-in cadastrado.`,
      );
    }
  }
}

function normalizeConnectPlans(plans: ConnectPlan[]): ConnectPlan[] {
  if (!plans.length) {
    throw new BadRequestException('Informe ao menos um plano.');
  }

  const seen = new Set<string>();
  return plans.map((plan, index) => {
    const id = plan.id?.trim();
    const name = plan.name?.trim();
    if (!id || !/^connect-[a-z0-9-]+$/.test(id)) {
      throw new BadRequestException(
        `ID inválido no plano "${name || `#${index + 1}`}". Use o formato connect-nome.`,
      );
    }
    if (seen.has(id)) {
      throw new BadRequestException(`ID duplicado: ${id}`);
    }
    seen.add(id);
    if (!name) {
      throw new BadRequestException(`Informe o nome do plano ${id}.`);
    }
    const price = Number(plan.pricePerMonth);
    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException(`Preço inválido no plano ${name}.`);
    }

    return {
      id,
      name,
      pricePerMonth: Math.round(price * 100) / 100,
      tierIndex: index,
      description: plan.description?.trim() ?? '',
    };
  });
}
