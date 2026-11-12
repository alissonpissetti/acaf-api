import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  buildAcafAssociateMeta,
  parseAcafAssociateSheetRows,
  type ParsedAcafAssociateRow,
  type ParsedAcafAssociateRowActive,
} from './acaf-associates-import.parser';
import { loadStore, updateStore } from './store';
import type { AcafAssociateMeta, AdminNetwork, ApiStore, GymUnit } from './types';
import { emptyNetworkSocialContacts } from './types';
import { currentMonthLabelBr } from './payoutMonth';
import { buildNewUnit, emptyMonthlyPayout } from './unitFactory';
import { normalizeWeeklySchedule } from './weeklySchedule';
import { UnitCoordinatesService } from './unit-coordinates.service';
import { AssociationsService } from '../associations/associations.service';
import { isImportedAssociateMeta } from './associate-meta';

export type AcafAssociatesImportOptions = {
  /** Slug do agrupador (`associations.slug`); padrão `acaf`. */
  associationSlug?: string;
  /** Marca como fora do catálogo unidades importadas antes que não aparecem na planilha. */
  syncMissing?: boolean;
  /**
   * Se true, reimportar atualiza unidades já existentes (mesmo CNPJ) com os dados da planilha.
   * Se false (padrão), linhas cujo CNPJ já está cadastrado são ignoradas — útil após agrupamento manual ou ajustes no admin.
   */
  updateExisting?: boolean;
};

export type AcafAssociatesImportResult = {
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  /** Linhas ativas ignoradas porque o CNPJ já existe (`updateExisting` desligado). */
  skippedExisting: number;
  reactivated: number;
  /** Linhas com status de remoção na planilha: cadastro mantido, só some do catálogo app. */
  deactivatedByStatus: number;
  /** CNPJs da planilha que sumiram do arquivo (só com syncMissing). */
  deactivatedSyncMissing: number;
  skipped: number;
  errors: { rowNumber: number; message: string }[];
  sample: {
    tradeName: string;
    cnpj: string;
    action: 'created' | 'updated' | 'deactivated_by_status' | 'skipped_existing';
  }[];
};

const LEGACY_ACAF_NETWORK_BY_CNPJ = /^net_acaf_\d{14}$/;

function slugifyTradeNameForNetworkId(tradeName: string, legalName: string): string {
  const base = (tradeName.trim() || legalName.trim()).toLowerCase();
  let slug = base
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  if (!slug) slug = 'grupo';
  return slug;
}

/** Rede agrupadora: várias unidades (CNPJs) sob o mesmo nome fantasia. */
function networkIdForAcafGroup(tradeName: string, legalName: string): string {
  return `net_acaf_grp_${slugifyTradeNameForNetworkId(tradeName, legalName)}`;
}

function unitIdForCnpj(cnpj: string): string {
  return `g_acaf_${cnpj}`;
}

/**
 * Resolve a unidade deste CNPJ: primeiro por metadado da importação, depois pelo id canônico `g_acaf_{cnpj}`.
 * Evita duplicar unidades quando já existe registro criado manualmente ou por fluxo antigo sem `acafAssociate`.
 */
function findUnitForAcafImport(store: ApiStore, cnpj: string): GymUnit | undefined {
  const byMeta = store.units.find((unit) => unit.acafAssociate?.cnpj === cnpj);
  if (byMeta) return byMeta;
  const canonicalId = unitIdForCnpj(cnpj);
  return store.units.find((unit) => unit.id === canonicalId);
}

function ensureAcafGroupNetwork(
  store: ApiStore,
  row: { tradeName: string; legalName: string },
): AdminNetwork {
  const displayName = row.tradeName.trim() || row.legalName.trim();
  const baseId = networkIdForAcafGroup(row.tradeName, row.legalName);
  let id = baseId;
  let suffix = 0;
  while (true) {
    const existing = store.networks.find((item) => item.id === id);
    if (!existing) break;
    if (existing.name.trim() === displayName.trim()) {
      existing.name = displayName;
      delete existing.cnpj;
      return existing;
    }
    suffix += 1;
    id = `${baseId}_${suffix}`;
  }

  const network: AdminNetwork = {
    id,
    name: displayName,
    logoUrl: null,
    social: emptyNetworkSocialContacts(),
    commercialOwnerUserId: null,
  };
  store.networks.push(network);
  return network;
}

/**
 * Migra unidades ACAF de redes antigas `net_acaf_{cnpj}` para agrupadores por nome fantasia
 * e remove redes legadas por CNPJ quando ficarem vazias.
 */
function migrateLegacyAcafNetworksToTradeNameGroups(store: ApiStore): void {
  for (const unit of store.units) {
    const meta = unit.acafAssociate;
    if (!isImportedAssociateMeta(meta)) continue;
    if (!LEGACY_ACAF_NETWORK_BY_CNPJ.test(unit.networkId)) continue;

    const tradeName = unit.unitName?.trim() ?? '';
    const legalName = meta.legalName?.trim() ?? tradeName;
    const network = ensureAcafGroupNetwork(store, { tradeName, legalName });
    unit.networkId = network.id;
  }

  const idsInUse = new Set(store.units.map((u) => u.networkId));
  store.networks = store.networks.filter((n) => {
    if (!LEGACY_ACAF_NETWORK_BY_CNPJ.test(n.id)) return true;
    if (idsInUse.has(n.id)) return true;
    return false;
  });
}

@Injectable()
export class AcafAssociatesImportService {
  constructor(
    private readonly unitCoordinates: UnitCoordinatesService,
    private readonly associations: AssociationsService,
  ) {}

  async importSpreadsheet(
    file: Express.Multer.File,
    options: AcafAssociatesImportOptions = {},
    commercialOwnerUserId?: string,
  ): Promise<AcafAssociatesImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o arquivo Excel (.xlsx).');
    }

    const associationSlug = options.associationSlug?.trim() || 'acaf';
    const association = await this.associations.requireBySlug(associationSlug);
    const associationId = association.id;

    const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('Nenhuma aba encontrada na planilha.');
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    });

    const parsed = parseAcafAssociateSheetRows(matrix);
    if (!parsed.rows.length && parsed.errors.length) {
      throw new BadRequestException(parsed.errors[0]?.message ?? 'Planilha inválida.');
    }

    const importedAt = new Date().toISOString();
    const importedCnpjs = new Set<string>();
    for (const row of parsed.rows) {
      importedCnpjs.add(row.cnpj);
    }

    updateStore((store) => {
      migrateLegacyAcafNetworksToTradeNameGroups(store);
    });

    const updateExisting = options.updateExisting === true;

    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let reactivated = 0;
    let deactivatedByStatus = 0;
    let deactivatedSyncMissing = 0;
    const extraErrors: { rowNumber: number; message: string }[] = [];
    const sample: AcafAssociatesImportResult['sample'] = [];

    for (const row of parsed.rows) {
      if (row.kind === 'remocao') {
        const n = await this.applyRemovalRow(row, importedAt, associationId);
        if (n.applied) {
          deactivatedByStatus += 1;
          if (sample.length < 8)
            sample.push({
              tradeName: n.tradeName,
              cnpj: row.cnpj,
              action: 'deactivated_by_status',
            });
        } else if (n.reason === 'not_found') {
          extraErrors.push({
            rowNumber: row.rowNumber,
            message: `Remoção: CNPJ ${row.cnpj} não encontrado (nada a inativar).`,
          });
        }
        continue;
      }

      const meta = buildAcafAssociateMeta(row, importedAt, true, associationId);
      const existing = findUnitForAcafImport(loadStore(), row.cnpj);

      if (existing) {
        if (!updateExisting) {
          skippedExisting += 1;
          if (sample.length < 8)
            sample.push({ tradeName: row.tradeName, cnpj: row.cnpj, action: 'skipped_existing' });
          continue;
        }
        const wasListed = existing.acafAssociate?.listed !== false;
        await this.applyRowToExistingUnit(existing.id, row, meta, commercialOwnerUserId);
        updated += 1;
        if (!wasListed) reactivated += 1;
        if (sample.length < 8) sample.push({ tradeName: row.tradeName, cnpj: row.cnpj, action: 'updated' });
        continue;
      }

      await this.createUnitFromRow(row, meta, commercialOwnerUserId);
      created += 1;
      if (sample.length < 8) sample.push({ tradeName: row.tradeName, cnpj: row.cnpj, action: 'created' });
    }

    if (options.syncMissing) {
      deactivatedSyncMissing = await this.deactivateMissingAssociates(importedCnpjs, importedAt, associationId);
    }

    const errors = [...parsed.errors, ...extraErrors].slice(0, 50);

    return {
      fileName: file.originalname ?? 'associados.xlsx',
      totalRows: parsed.rows.length,
      created,
      updated,
      skippedExisting,
      reactivated,
      deactivatedByStatus,
      deactivatedSyncMissing,
      skipped: parsed.errors.length + extraErrors.length,
      errors,
      sample,
    };
  }

  private async applyRemovalRow(
    row: Extract<ParsedAcafAssociateRow, { kind: 'remocao' }>,
    importedAt: string,
    associationId: string,
  ): Promise<{ applied: boolean; reason?: 'not_found'; tradeName: string }> {
    const store = loadStore();
    const unit = findUnitForAcafImport(store, row.cnpj);
    if (!unit) {
      return { applied: false, reason: 'not_found', tradeName: '' };
    }

    const prev = unit.acafAssociate;
    const baseAssociationId = prev?.associationId ?? associationId;
    const baseMeta: AcafAssociateMeta = prev ?? {
      associationId: baseAssociationId,
      cnpj: row.cnpj,
      legalName: unit.unitName,
      association: 'movly.',
      signedAt: importedAt.slice(0, 10),
      contactEmail: '',
      importSource: 'acaf_associates_xlsx',
      importedAt,
      listed: false,
    };

    const nextMeta: AcafAssociateMeta = {
      ...baseMeta,
      importedAt,
      listed: false,
      spreadsheetStatus: 'remocao',
      spreadsheetStatusRaw: row.spreadsheetStatusRaw ?? baseMeta.spreadsheetStatusRaw,
    };

    let nextUnit: GymUnit = {
      ...unit,
      acafAssociate: nextMeta,
    };
    nextUnit = await this.unitCoordinates.applyIfNeeded(unit, nextUnit);

    updateStore((draft) => {
      migrateLegacyAcafNetworksToTradeNameGroups(draft);
      const idx = draft.units.findIndex((u) => u.id === unit.id);
      if (idx >= 0) draft.units[idx] = nextUnit;
    });

    return { applied: true, tradeName: unit.unitName };
  }

  private async applyRowToExistingUnit(
    unitId: string,
    row: ParsedAcafAssociateRowActive,
    meta: AcafAssociateMeta,
    commercialOwnerUserId?: string,
  ) {
    const store = loadStore();
    const before = store.units.find((item) => item.id === unitId);
    if (!before) return;

    const description = `${row.legalName} · Associado ${row.association} desde ${row.signedAt.split('-').reverse().join('/')}.`;

    let next: GymUnit = {
      ...before,
      unitName: row.tradeName,
      zip: row.zip,
      address: row.address,
      number: row.number,
      complement: row.complement ?? before.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      description,
      acafAssociate: { ...meta, listed: true },
    };

    next = await this.unitCoordinates.applyIfNeeded(before, next);

    updateStore((draft) => {
      migrateLegacyAcafNetworksToTradeNameGroups(draft);
      const network = ensureAcafGroupNetwork(draft, row);
      if (commercialOwnerUserId && !network.commercialOwnerUserId) {
        network.commercialOwnerUserId = commercialOwnerUserId;
      }
      const index = draft.units.findIndex((item) => item.id === unitId);
      if (index >= 0) {
        draft.units[index] = { ...next, networkId: network.id };
      }
    });
  }

  private async createUnitFromRow(
    row: ParsedAcafAssociateRowActive,
    meta: AcafAssociateMeta,
    commercialOwnerUserId?: string,
  ) {
    const description = `${row.legalName} · Associado ${row.association} desde ${row.signedAt.split('-').reverse().join('/')}.`;
    const weeklySchedule = normalizeWeeklySchedule(undefined);
    const storeSnapshot = loadStore();

    let createdUnit = buildNewUnit(storeSnapshot, {
      networkId: 'net_acaf_grp_pending',
      unitName: row.tradeName,
      zip: row.zip,
      address: row.address,
      number: row.number,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      weeklySchedule,
      description,
    });

    createdUnit.id = unitIdForCnpj(row.cnpj);
    createdUnit.acafAssociate = meta;

    createdUnit = await this.unitCoordinates.applyToUnit(createdUnit);

    updateStore((store) => {
      migrateLegacyAcafNetworksToTradeNameGroups(store);
      const networkInStore = ensureAcafGroupNetwork(store, row);
      if (commercialOwnerUserId) {
        networkInStore.commercialOwnerUserId = commercialOwnerUserId;
      }
      createdUnit.networkId = networkInStore.id;
      store.units.push(createdUnit);
      const monthLabel = Object.values(store.payoutsByUnit)[0]?.monthLabel ?? currentMonthLabelBr();
      store.payoutsByUnit[createdUnit.id] = emptyMonthlyPayout(monthLabel);
      store.payoutHistoryByUnit[createdUnit.id] = [store.payoutsByUnit[createdUnit.id]];
    });
  }

  private async deactivateMissingAssociates(
    importedCnpjs: Set<string>,
    importedAt: string,
    associationId: string,
  ): Promise<number> {
    let count = 0;
    updateStore((store) => {
      migrateLegacyAcafNetworksToTradeNameGroups(store);
      for (const unit of store.units) {
        const meta = unit.acafAssociate;
        if (!isImportedAssociateMeta(meta)) continue;
        if (meta.associationId && meta.associationId !== associationId) continue;
        if (importedCnpjs.has(meta.cnpj)) continue;
        if (meta.listed === false) continue;
        unit.acafAssociate = {
          ...meta,
          listed: false,
          importedAt,
        };
        count += 1;
      }
    });
    return count;
  }
}
