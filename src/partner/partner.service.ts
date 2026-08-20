import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UnitScope } from './aggregatePayout';
import { applySuccessfulCheckIn, duplicateCheckInTodayMessage, normalizeHolderKey, requestGeoCheckIn as processGeoCheckInRequest, validateCheckInCode } from './checkIn';
import {
  approvePendingCheckIn,
  dismissPendingCheckIn,
  pendingForUnit,
  processAutoApproveForUnit,
} from './pendingCheckIn';
import {
  cancelReservation,
  createReservation,
  getAvailability,
  getScheduledModalities,
  markReservationCheckedIn,
  reservationsForHolder,
  reservationsForUnitDate,
  reservationsForUnitRange,
  templateHasFutureReservations,
} from './modalitySchedule';
import {
  expandDailyPassOffers,
  normalizeDailyPassPricingRules,
  resolveDailyPassOffer,
  validateDailyPassPricingRules,
} from './dailyPassPricing';
import { ModalitiesService } from '../modalities/modalities.service';
import { getDomain, loadStore, updateStore } from './store';
import { assertUnitAccess, filterStoreByUnitIds } from './partnerAccess';
import {
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
} from './weeklySchedule';
import {
  portalPayloadFromStore,
  type ApiStore,
  type ConnectPlanId,
  type GymUnit,
  type ModalityReservation,
  type ModalitySlotOverride,
  type ModalitySlotTemplate,
} from './types';
import { buildNewUnit, emptyMonthlyPayout, type CreateUnitInput } from './unitFactory';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { registerDailyPassPurchase } from './dailyPassSales';
import { isRemotePhotoUrl, resolveCatalogPhotoUrl, sanitizeUnitPhotosForApi } from './photoUrls';
import { UnitScheduleService } from './unit-schedule.service';
import { UnitCoordinatesService } from './unit-coordinates.service';
import {
  getConnectMemberProfile,
  setConnectPrimaryGym as assignConnectPrimaryGym,
  upsertConnectSubscription,
  validateConnectCheckInAtUnit,
  type ConnectMemberProfile,
} from './connectMember';
import { getPartnerClientDetail, listPartnerClients } from './partnerClients';

function scopeFromQuery(scope?: string): UnitScope {
  return scope === 'all' ? 'all' : 'single';
}

function scopedStore(unitIds?: string[]): ApiStore {
  const store = loadStore();
  if (!unitIds?.length) return store;
  return filterStoreByUnitIds(store, unitIds);
}

@Injectable()
export class PartnerService {
  constructor(
    private readonly modalities: ModalitiesService,
    private readonly unitSchedule: UnitScheduleService,
    private readonly unitCoordinates: UnitCoordinatesService,
    private readonly corporateAccess: CorporateAccessService,
  ) {}

  getHealth() {
    return { status: 'ok', service: 'acaf-api' };
  }

  getTest() {
    return {
      ok: true,
      service: 'acaf-api',
      message: 'API no ar',
      docs: '/docs',
      openapi: '/docs/openapi.json',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getDomain() {
    const domain = getDomain() as Record<string, unknown>;
    return {
      ...domain,
      modalityCatalog: await this.modalities.listActiveNames(),
    };
  }

  getBootstrap(unitIds?: string[]) {
    const store = scopedStore(unitIds);
    return {
      networkId: store.networkId,
      networkName: store.networkName,
      activeUnitId: store.activeUnitId,
      units: store.units.map(sanitizeUnitPhotosForApi),
      students: store.students,
      payoutsByUnit: store.payoutsByUnit,
      payoutHistoryByUnit: store.payoutHistoryByUnit,
      checkInLog: store.checkInLog,
    };
  }

  getPortal(scope?: string, unitIds?: string[]) {
    const store = scopedStore(unitIds);
    return portalPayloadFromStore(store, true, scopeFromQuery(scope));
  }

  listClients(scope?: string, unitIds?: string[]) {
    const store = scopedStore(unitIds);
    const unitScope = scopeFromQuery(scope);
    return listPartnerClients(store, store.units.map((u) => u.id), unitScope);
  }

  getClient(holderKey: string, scope?: string, unitIds?: string[]) {
    const store = scopedStore(unitIds);
    const unitScope = scopeFromQuery(scope);
    return getPartnerClientDetail(store, store.units.map((u) => u.id), holderKey, unitScope);
  }

  patchActiveUnit(unitId: string, scope?: string, unitIds?: string[]) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const unitScope = scopeFromQuery(scope);
    const store = updateStore((s) => {
      if (s.units.some((u) => u.id === unitId)) {
        s.activeUnitId = unitId;
      }
    });
    const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
    return portalPayloadFromStore(filtered, true, unitScope);
  }

  assertPartnerUnitAccess(unitId: string, unitIds: string[]) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
  }

  async patchUnit(unitId: string, patch: Partial<GymUnit>, scope?: string, unitIds?: string[]) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const unitScope = scopeFromQuery(scope);
    const current = loadStore().units.find((u) => u.id === unitId);
    if (!current) throw new NotFoundException('Unidade não encontrada.');

    const { heroPhotoDataUrl, galleryPhotoDataUrls, ...rest } = patch;
    let merged: GymUnit = { ...current, ...rest, id: unitId };
    if (heroPhotoDataUrl !== undefined && isRemotePhotoUrl(heroPhotoDataUrl)) {
      merged.heroPhotoDataUrl = heroPhotoDataUrl;
    }
    if (
      galleryPhotoDataUrls !== undefined &&
      galleryPhotoDataUrls.every((url) => isRemotePhotoUrl(url))
    ) {
      merged.galleryPhotoDataUrls = galleryPhotoDataUrls;
    }
    if (patch.weeklySchedule) {
      merged.weeklySchedule = normalizeWeeklySchedule(patch.weeklySchedule);
      merged.openHours = formatOpenHoursSummary(merged.weeklySchedule);
    }
    if (patch.dailyPassPricingRules !== undefined) {
      merged.dailyPassPricingRules = normalizeDailyPassPricingRules(
        merged,
        patch.dailyPassPricingRules,
      );
      const ruleError = validateDailyPassPricingRules(merged, merged.dailyPassPricingRules);
      if (ruleError) throw new BadRequestException(ruleError);
    }

    merged = await this.unitCoordinates.applyIfNeeded(current, merged);

    const store = updateStore((s) => {
      const idx = s.units.findIndex((u) => u.id === unitId);
      if (idx < 0) return;
      s.units[idx] = merged;
    });
    const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
    return portalPayloadFromStore(filtered, true, unitScope);
  }

  async createUnit(body: CreateUnitInput, scope?: string, unitIds?: string[]) {
    if (unitIds?.length) {
      throw new ForbiddenException('Parceiros não podem criar unidades pelo portal.');
    }
    const unitName = body.unitName?.trim() ?? '';
    const neighborhood = body.neighborhood?.trim() ?? '';
    const city = body.city?.trim() ?? '';
    if (!unitName || !neighborhood || !city) {
      throw new BadRequestException('Informe nome, bairro e cidade da unidade.');
    }

    const unitScope = scopeFromQuery(scope);
    const current = loadStore();
    let unit = buildNewUnit(current, {
      ...body,
      unitName,
      neighborhood,
      city,
      networkId: current.networkId,
    });
    unit = await this.unitCoordinates.applyToUnit(unit);

    const store = updateStore((s) => {
      s.units.push(unit);
      s.activeUnitId = unit.id;
      const monthLabel = Object.values(s.payoutsByUnit)[0]?.monthLabel ?? 'Julho 2026';
      s.payoutsByUnit[unit.id] = emptyMonthlyPayout(monthLabel);
      s.payoutHistoryByUnit[unit.id] = [s.payoutsByUnit[unit.id]];
    });
    const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
    return portalPayloadFromStore(filtered, true, unitScope);
  }

  getUnitPublic(unitId: string) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new NotFoundException('not_found');
    }
    const { heroPhotoDataUrl, galleryPhotoDataUrls, ...rest } = unit;
    return {
      networkId: store.networkId,
      networkName: store.networkName,
      scheduledModalities: getScheduledModalities(unit),
      unit: {
        ...rest,
        hasHeroPhoto: Boolean(heroPhotoDataUrl),
        galleryCount: galleryPhotoDataUrls.length,
      },
    };
  }

  getDailyPassOffers(unitId: string, date: string) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Informe date (YYYY-MM-DD).');
    }
    return {
      unitId,
      date,
      offers: expandDailyPassOffers(unit, date),
    };
  }

  validateCheckIn(
    unitId: string,
    code: string,
    scope?: string,
    unitIds?: string[],
    holderName?: string,
  ) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = loadStore();
    const result = validateCheckInCode(store, unitId, code);
    if (!result.ok) {
      throw new BadRequestException({ ok: false, message: result.message });
    }

    const trimmedHolder = holderName?.trim() ?? '';
    const effectiveResult =
      trimmedHolder.length > 0 ? { ...result, holderName: trimmedHolder } : result;

    if (effectiveResult.type === 'connect_member') {
      const nameForPrimary = trimmedHolder || effectiveResult.holderName;
      const primaryBlock = validateConnectCheckInAtUnit(store, nameForPrimary, unitId);
      if (primaryBlock) {
        throw new BadRequestException({ ok: false, message: primaryBlock });
      }
    }

    const duplicate = duplicateCheckInTodayMessage(store, unitId, effectiveResult, code);
    if (duplicate) {
      throw new BadRequestException({ ok: false, message: duplicate });
    }
    const updated = updateStore((s) => {
      applySuccessfulCheckIn(s, unitId, effectiveResult, code);
    });
    const log = updated.checkInLog[updated.checkInLog.length - 1];
    const unitScope = scopeFromQuery(scope);
    const filtered = unitIds?.length ? filterStoreByUnitIds(updated, unitIds) : updated;
    return {
      ok: true,
      message: result.message,
      entry: log,
      portal: portalPayloadFromStore(filtered, true, unitScope),
    };
  }

  issueCheckIn(body: {
    code: string;
    unitId: string;
    holderName: string;
    validUntil: string;
    type?: 'daily_pass';
    offerId?: string;
    occurrenceDate?: string;
    companyName?: string;
    companySlug?: string;
  }) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === body.unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');

    const occurrenceDate = body.occurrenceDate ?? new Date().toISOString().slice(0, 10);
    let pricingRuleId: string | null = null;
    let allowedModalities: string[] | undefined;
    let validWindowStart: string | undefined;
    let validWindowEnd: string | undefined;
    let pricePaid: number | undefined;

    if (body.offerId) {
      const offer = resolveDailyPassOffer(unit, body.offerId, occurrenceDate);
      if (!offer) {
        throw new BadRequestException('Oferta de diária inválida para esta data.');
      }
      pricingRuleId = offer.pricingRuleId ?? null;
      allowedModalities = offer.modalities;
      pricePaid = offer.price;
      if (offer.kind === 'window' && offer.startTime && offer.endTime) {
        validWindowStart = offer.startTime;
        validWindowEnd = offer.endTime;
      }
    }

    updateStore((s) => {
      s.issuedCodes = s.issuedCodes.filter((x) => x.code !== body.code);
      s.issuedCodes.push({
        code: body.code.toUpperCase(),
        type: body.type ?? 'daily_pass',
        unitId: body.unitId,
        holderName: body.holderName,
        validUntil: body.validUntil,
        pricingRuleId,
        allowedModalities,
        validWindowStart,
        validWindowEnd,
        pricePaid,
        occurrenceDate,
      });

      registerDailyPassPurchase(s, {
        unitId: body.unitId,
        holderName: body.holderName,
        code: body.code,
        pricePaid: pricePaid ?? unit.dailyPassPrice,
        occurrenceDate,
        companyName: body.companyName,
        companySlug: body.companySlug,
      });
    });
    return { ok: true, issued: body.code, pricePaid: pricePaid ?? unit.dailyPassPrice };
  }

  requestGeoCheckIn(body: {
    unitId: string;
    code: string;
    holderName: string;
    latitude: number;
    longitude: number;
  }) {
    const unitId = body.unitId?.trim();
    const code = body.code?.trim() ?? '';
    const holderName = body.holderName?.trim() ?? '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!unitId || !code) {
      throw new BadRequestException('Informe unidade e código de check-in.');
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Localização inválida. Ative o GPS no celular.');
    }

    let entry:
      | import('./types').CheckInLogEntry
      | undefined;
    let message = '';
    let failed = '';

    const store = updateStore((s) => {
      const result = processGeoCheckInRequest(s, unitId, code, holderName, latitude, longitude);
      if (!result.ok) {
        failed = result.message;
        return;
      }
      entry = result.entry;
      message = result.message;
    });

    if (failed || !entry) {
      throw new BadRequestException({
        ok: false,
        message: failed || 'Não foi possível registrar o check-in.',
      });
    }

    return {
      ok: true,
      message,
      entry,
      portal: portalPayloadFromStore(store, true, 'single'),
    };
  }

  getPendingCheckIns(unitId: string, scope?: string, unitIds?: string[]) {
    if (!unitId) {
      throw new BadRequestException('Informe a unidade.');
    }
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const unitScope = scopeFromQuery(scope);
    let approvedCount = 0;
    const store = updateStore((s) => {
      approvedCount = processAutoApproveForUnit(s, unitId);
    });
    const body: {
      pending: ReturnType<typeof pendingForUnit>;
      approvedCount: number;
      portal?: ReturnType<typeof portalPayloadFromStore>;
    } = {
      pending: pendingForUnit(store, unitId),
      approvedCount,
    };
    if (approvedCount > 0) {
      const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
      body.portal = portalPayloadFromStore(filtered, true, unitScope);
    }
    return body;
  }

  approvePending(pendingId: string, unitId: string, scope?: string, unitIds?: string[]) {
    if (!unitId) {
      throw new BadRequestException('Informe a unidade.');
    }
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    let message = '';
    let failed = '';
    const store = updateStore((s) => {
      const result = approvePendingCheckIn(s, pendingId, unitId);
      if (!result.ok) {
        failed = result.message;
        return;
      }
      message = result.message;
    });
    if (failed) {
      throw new BadRequestException({ ok: false, message: failed });
    }
    const unitScope = scopeFromQuery(scope);
    const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
    return {
      ok: true,
      message,
      portal: portalPayloadFromStore(filtered, true, unitScope),
    };
  }

  dismissPending(pendingId: string, unitId: string, scope?: string, unitIds?: string[]) {
    if (!unitId) {
      throw new BadRequestException('Informe a unidade.');
    }
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = updateStore((s) => {
      dismissPendingCheckIn(s, pendingId, unitId);
    });
    const unitScope = scopeFromQuery(scope);
    const filtered = unitIds?.length ? filterStoreByUnitIds(store, unitIds) : store;
    return {
      ok: true,
      portal: portalPayloadFromStore(filtered, true, unitScope),
      pending: pendingForUnit(store, unitId),
    };
  }

  getConnectMember(holderName: string): ConnectMemberProfile | null {
    return getConnectMemberProfile(holderName);
  }

  listActiveDailyPasses(holderName: string) {
    const key = normalizeHolderKey(holderName);
    if (!key) return [];
    const nowIso = new Date().toISOString();
    const store = loadStore();
    return store.issuedCodes
      .filter(
        (code) =>
          code.type === 'daily_pass' &&
          normalizeHolderKey(code.holderName) === key &&
          code.validUntil >= nowIso,
      )
      .map((code) => ({
        code: code.code,
        unitId: code.unitId,
        holderName: code.holderName,
        validUntil: code.validUntil,
        pricePaid: code.pricePaid,
        allowedModalities: code.allowedModalities ?? [],
        validWindowStart: code.validWindowStart,
        validWindowEnd: code.validWindowEnd,
        occurrenceDate: code.occurrenceDate,
      }));
  }

  registerConnectSubscription(body: {
    holderName: string;
    connectPlanId: ConnectPlanId;
    active?: boolean;
    companyName?: string;
  }): ConnectMemberProfile {
    try {
      return upsertConnectSubscription(body);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Falha ao registrar assinatura.');
    }
  }

  setConnectPrimaryGym(holderName: string, unitId: string): ConnectMemberProfile {
    try {
      return assignConnectPrimaryGym(holderName, unitId);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Não foi possível definir a academia principal.');
    }
  }

  getSharedDomainJson() {
    return readFileSync(join(process.cwd(), 'shared', 'connect_domain.json'), 'utf-8');
  }

  async getModalitySlots(unitId: string, unitIds?: string[]) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    const schedule = await this.unitSchedule.getSchedule(unitId, unit);
    const unitWithSchedule = this.unitSchedule.attachToUnit(unit, schedule);
    return {
      ...schedule,
      scheduledModalities: getScheduledModalities(unitWithSchedule),
    };
  }

  async putModalitySlots(
    unitId: string,
    body: { templates: ModalitySlotTemplate[]; instructors?: string[] },
    unitIds?: string[],
  ) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');

    const current = await this.unitSchedule.getSchedule(unitId, unit);
    const currentIds = new Set(current.templates.map((t) => t.id));
    const nextIds = new Set(body.templates.map((t) => t.id));
    for (const removedId of currentIds) {
      if (!nextIds.has(removedId) && templateHasFutureReservations(store, unitId, removedId)) {
        throw new BadRequestException(
          'Não é possível remover faixa com reservas futuras confirmadas.',
        );
      }
    }

    const saved = await this.unitSchedule.saveTemplates(unit, body.templates, body.instructors);
    const unitWithSchedule = this.unitSchedule.attachToUnit(unit, saved);
    return {
      ...saved,
      scheduledModalities: getScheduledModalities(unitWithSchedule),
    };
  }

  async putModalitySlotOverrides(
    unitId: string,
    body: { overrides: ModalitySlotOverride[] },
    unitIds?: string[],
  ) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    const saved = await this.unitSchedule.saveOverrides(unit, body.overrides);
    const unitWithSchedule = this.unitSchedule.attachToUnit(unit, saved);
    return {
      ...saved,
      scheduledModalities: getScheduledModalities(unitWithSchedule),
    };
  }

  getModalityReservations(
    unitId: string,
    query: { date?: string; from?: string; to?: string },
    unitIds?: string[],
  ) {
    if (unitIds?.length) assertUnitAccess(unitId, unitIds);
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    if (query.from && query.to) {
      return {
        from: query.from,
        to: query.to,
        reservations: reservationsForUnitRange(store, unitId, query.from, query.to),
      };
    }
    if (query.date) {
      return {
        date: query.date,
        reservations: reservationsForUnitDate(store, unitId, query.date),
      };
    }
    throw new BadRequestException('Informe date ou from e to (YYYY-MM-DD).');
  }

  async getModalityAvailability(
    unitId: string,
    from: string,
    to: string,
    modality?: string,
  ) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    if (!from || !to) throw new BadRequestException('Informe from e to (YYYY-MM-DD).');
    const unitWithSchedule = await this.unitSchedule.unitWithSchedule(unit);
    return {
      unitId,
      from,
      to,
      scheduledModalities: getScheduledModalities(unitWithSchedule),
      slots: getAvailability(store, unitWithSchedule, from, to, modality),
    };
  }

  async postModalityReservation(body: {
    unitId: string;
    occurrenceDate: string;
    slotTemplateId?: string;
    overrideId?: string;
    holderName: string;
    holderUserId?: string;
  }): Promise<ModalityReservation> {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === body.unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    const unitWithSchedule = await this.unitSchedule.unitWithSchedule(unit);
    try {
      const updated = updateStore((s) => {
        const idx = s.units.findIndex((u) => u.id === body.unitId);
        if (idx >= 0) {
          s.units[idx] = this.unitSchedule.attachToUnit(s.units[idx]!, {
            templates: unitWithSchedule.modalitySlotTemplates ?? [],
            overrides: unitWithSchedule.modalitySlotOverrides ?? [],
            instructors: unitWithSchedule.instructors ?? [],
          });
        }
        createReservation(s, body);
      });
      return updated.modalityReservations!.slice(-1)[0]!;
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Não foi possível reservar.');
    }
  }

  deleteModalityReservation(reservationId: string) {
    try {
      updateStore((s) => {
        cancelReservation(s, reservationId);
      });
      return { ok: true };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Não foi possível cancelar.');
    }
  }

  listModalityReservations(holderName?: string) {
    const store = loadStore();
    return {
      reservations: holderName ? reservationsForHolder(store, holderName) : [],
    };
  }

  async validateConnectEnrollmentCode(rawCode: string) {
    const trimmed = rawCode.trim();
    if (!trimmed) {
      throw new BadRequestException('Informe o código de adesão.');
    }
    const company = await this.corporateAccess.findActiveByEnrollmentCode(trimmed);
    if (!company) {
      throw new BadRequestException('Código inválido ou expirado. Verifique com o RH da sua empresa.');
    }
    return {
      companyName: company.tradeName,
      code: company.enrollmentCode!,
      hint: 'Código validado pela empresa parceira.',
    };
  }

  getCatalogCities() {
    const store = loadStore();
    const cities = new Set<string>();
    for (const unit of this.unitsForCatalog(store)) {
      const city = unit.city.split('/')[0].trim();
      if (city) cities.add(city);
    }
    return { cities: [...cities].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  }

  getCatalog(filters?: { city?: string; q?: string }) {
    const store = loadStore();
    const networkMap = new Map(store.networks.map((n) => [n.id, n]));
    const cityNeedle = filters?.city?.trim().toLowerCase();
    const q = filters?.q?.trim().toLowerCase();

    let units = this.unitsForCatalog(store);
    if (cityNeedle) {
      units = units.filter((u) => u.city.toLowerCase().includes(cityNeedle));
    }
    if (q) {
      units = units.filter((u) => {
        const network = networkMap.get(u.networkId);
        const haystack = [
          u.unitName,
          u.neighborhood,
          u.city,
          u.description,
          network?.name ?? '',
          ...u.modalities,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    const unitRows = units.map((unit) => this.toCatalogUnitDto(unit, networkMap.get(unit.networkId)));
    const networks = store.networks
      .map((network) => ({
        id: network.id,
        name: network.name,
        logoUrl: network.logoUrl ?? null,
        unitCount: units.filter((u) => u.networkId === network.id).length,
      }))
      .filter((network) => network.unitCount > 0);

    return { networks, units: unitRows };
  }

  getCatalogUnit(unitId: string) {
    const store = loadStore();
    const unit = this.unitsForCatalog(store).find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    const network = store.networks.find((n) => n.id === unit.networkId);
    return this.toCatalogUnitDto(unit, network, true);
  }

  streamUnitHeroPhoto(unitId: string, res: Response) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    const photoRef = unit?.heroPhotoDataUrl;
    if (!photoRef) throw new NotFoundException('Foto não encontrada.');
    if (isRemotePhotoUrl(photoRef)) {
      res.redirect(photoRef);
      return;
    }
    this.streamDataUrl(photoRef, res);
  }

  streamUnitGalleryPhoto(unitId: string, index: number, res: Response) {
    const store = loadStore();
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    const photoRef = unit.galleryPhotoDataUrls[index];
    if (!photoRef) throw new NotFoundException('Foto não encontrada.');
    if (isRemotePhotoUrl(photoRef)) {
      res.redirect(photoRef);
      return;
    }
    this.streamDataUrl(photoRef, res);
  }

  /** Unidades de redes cadastradas no admin (sem órfãs de teste). */
  private unitsForCatalog(store: { networks: { id: string }[]; units: GymUnit[] }): GymUnit[] {
    const networkIds = new Set(store.networks.map((n) => n.id));
    return store.units.filter((u) => networkIds.has(u.networkId));
  }

  private toCatalogUnitDto(
    unit: GymUnit,
    network?: { id: string; name: string; logoUrl?: string | null },
    includeDescription = false,
  ) {
    const { heroPhotoDataUrl, galleryPhotoDataUrls, ...rest } = unit;
    const scheduledModalities = getScheduledModalities(unit);
    const galleryPhotoUrls = galleryPhotoDataUrls
      .map((url, index) =>
        resolveCatalogPhotoUrl(url, `/api/catalog/units/${unit.id}/gallery/${index}`),
      )
      .filter((url): url is string => Boolean(url));

    return {
      id: unit.id,
      networkId: unit.networkId,
      networkName: network?.name ?? unit.networkId,
      networkLogoUrl: network?.logoUrl ?? null,
      name: unit.unitName,
      unitName: unit.unitName,
      neighborhood: unit.neighborhood,
      city: unit.city,
      openHours: unit.openHours,
      weeklySchedule: unit.weeklySchedule
        ? normalizeWeeklySchedule(unit.weeklySchedule)
        : undefined,
      description: includeDescription ? unit.description : undefined,
      modalities: unit.modalities,
      dailyPassPrice: unit.dailyPassPrice,
      dailyPassActive: unit.dailyPassActive,
      dailyPassModalities: unit.dailyPassModalities,
      planSpecs: unit.planSpecs.filter((spec) => spec.enabled),
      latitude: unit.latitude,
      longitude: unit.longitude,
      scheduledModalities,
      hasHeroPhoto: Boolean(heroPhotoDataUrl),
      heroPhotoUrl: resolveCatalogPhotoUrl(
        heroPhotoDataUrl,
        `/api/catalog/units/${unit.id}/hero`,
      ),
      galleryPhotoUrls,
      ...(!includeDescription
        ? {}
        : {
            address: rest.address,
            zip: rest.zip,
            state: rest.state,
          }),
    };
  }

  private streamDataUrl(dataUrl: string, res: Response) {
    const match = /^data:([^;]+);base64,([\s\S]+)$/u.exec(dataUrl);
    if (!match) throw new BadRequestException('Formato de imagem inválido.');
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    res.setHeader('Content-Type', match[1]);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  }
}
