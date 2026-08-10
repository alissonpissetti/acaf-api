import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NextcloudService } from '../storage/nextcloud.service';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { UsersService } from '../users/users.service';
import { ModalitiesService } from '../modalities/modalities.service';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateCompaniesService } from '../corporate/corporate-companies.service';
import { CorporateEmployeesService } from '../corporate/corporate-employees.service';
import type { CompanyStatus } from '../corporate/company.entity';
import { getDomain, loadStore, saveDomain, updateStore } from './store';
import type { AdminNetwork, GymUnit, NetworkSocialContacts } from './types';
import { emptyNetworkSocialContacts } from './types';
import {
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
  type UnitWeeklySchedule,
} from './weeklySchedule';
import { buildNewUnit, emptyMonthlyPayout } from './unitFactory';
import { isRemotePhotoUrl } from './photoUrls';
import { UnitCoordinatesService } from './unit-coordinates.service';
import { cancelCheckInEntry, listCheckInsForUnit } from './checkIn';

type ConnectPlan = {
  id: string;
  name: string;
  pricePerMonth: number;
  tierIndex: number;
  description: string;
};

type ConnectDomain = {
  schemaVersion: number;
  acafConnectFeePercent: number;
  acafDailyFeePercent: number;
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
  ) {}

  private withUnitCount(network: AdminNetwork): AdminNetwork & { unitCount: number } {
    const store = loadStore();
    return {
      ...network,
      unitCount: store.units.filter((u) => u.networkId === network.id).length,
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
  getOverview() {
    const store = loadStore();
    const domain = getDomain() as ConnectDomain;
    return {
      networks: store.networks,
      unitCount: store.units.length,
      planCount: domain.connectPlans?.length ?? 0,
      connectFeePercent: domain.acafConnectFeePercent,
      dailyFeePercent: domain.acafDailyFeePercent,
    };
  }

  listNetworks(): (AdminNetwork & { unitCount: number })[] {
    const store = loadStore();
    return store.networks.map((network) => this.withUnitCount(network));
  }

  createNetwork(name: string, social?: Partial<NetworkSocialContacts>) {
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
      };
      s.networks.push(created);
    });
    return this.withUnitCount(created!);
  }

  updateNetwork(
    id: string,
    patch: {
      name?: string;
      logoUrl?: string | null;
      social?: Partial<NetworkSocialContacts>;
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
      updated = { ...network };
    });

    return this.withUnitCount(updated!);
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
      const monthLabel = Object.values(s.payoutsByUnit)[0]?.monthLabel ?? 'Julho 2026';
      s.payoutsByUnit[unit.id] = emptyMonthlyPayout(monthLabel);
      s.payoutHistoryByUnit[unit.id] = [s.payoutsByUnit[unit.id]];
    });
    return this.listUnits(networkId);
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
    const { heroPhotoDataUrl, galleryPhotoDataUrls, ...rest } = patch;
    let next: GymUnit = { ...before, ...rest, id: unitId };
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
    });
    return this.listUnits();
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

  deleteUnit(unitId: string) {
    const current = loadStore();
    const unit = current.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('Unidade não encontrada.');
    }

    const networkId = unit.networkId;

    updateStore((s) => {
      s.units = s.units.filter((u) => u.id !== unitId);
      delete s.payoutsByUnit[unitId];
      delete s.payoutHistoryByUnit[unitId];
      s.students = s.students.filter((student) => student.unitId !== unitId);
      s.checkInLog = s.checkInLog.filter((entry) => entry.unitId !== unitId);
      s.pendingCheckIns = s.pendingCheckIns.filter((entry) => entry.unitId !== unitId);
      s.issuedCodes = s.issuedCodes.filter((entry) => entry.unitId !== unitId);

      if (s.activeUnitId === unitId) {
        const fallback =
          s.units.find((u) => u.networkId === networkId) ?? s.units[0] ?? null;
        if (fallback) {
          s.activeUnitId = fallback.id;
          s.networkId = fallback.networkId;
          const network = s.networks.find((n) => n.id === fallback.networkId);
          if (network) s.networkName = network.name;
        }
      }
    });

    void this.partnerAccess.removeAccessForUnit(unitId);

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
    domain.modalityCatalog = await this.modalities.listActiveNames();
    return domain;
  }

  updateConnectDomain(body: {
    acafConnectFeePercent?: number;
    acafDailyFeePercent?: number;
    connectPlans?: ConnectPlan[];
  }) {
    const domain = { ...(getDomain() as ConnectDomain) };
    if (body.acafConnectFeePercent != null) {
      domain.acafConnectFeePercent = body.acafConnectFeePercent;
    }
    if (body.acafDailyFeePercent != null) {
      domain.acafDailyFeePercent = body.acafDailyFeePercent;
    }
    if (body.connectPlans) {
      domain.connectPlans = normalizeConnectPlans(body.connectPlans);
    }
    saveDomain(domain);
    return domain;
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
        this.corporateCompanies.toCompanyDto(company, {
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
      ...this.corporateCompanies.toCompanyDto(company, {
        managers: managers.length,
        employees: employees.length,
      }),
      managers,
      employees,
    };
  }

  async updateCompanyStatus(id: string, status: CompanyStatus) {
    const company = await this.corporateAccess.updateCompanyStatus(id, status);
    return this.corporateCompanies.toCompanyDto(company);
  }

  addCompanyManager(companyId: string, userId: string) {
    return this.corporateAccess.linkUserToCompany(companyId, userId);
  }

  removeCompanyManager(companyId: string, userId: string) {
    return this.corporateAccess.unlinkUserFromCompany(companyId, userId);
  }
}

function normalizeConnectPlans(plans: ConnectPlan[]): ConnectPlan[] {
  if (!plans.length) {
    throw new BadRequestException('Informe ao menos um plano Connect.');
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
