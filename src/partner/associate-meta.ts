import type { AcafAssociateMeta } from './types';

/** Fontes conhecidas de importação de associados (planilha). */
export const ASSOCIATE_IMPORT_SOURCES = ['acaf_associates_xlsx', 'associates_xlsx'] as const;
export type AssociateImportSource = (typeof ASSOCIATE_IMPORT_SOURCES)[number];

/** Cadastro fiscal preenchido manualmente no admin (fora da planilha). */
export const ADMIN_MANUAL_ASSOCIATE_SOURCE = 'admin_manual' as const;
export type AdminManualAssociateSource = typeof ADMIN_MANUAL_ASSOCIATE_SOURCE;

export function isAssociateImportSource(value: string): value is AssociateImportSource {
  return (ASSOCIATE_IMPORT_SOURCES as readonly string[]).includes(value);
}

export type SpreadsheetAcafAssociateMeta = AcafAssociateMeta & {
  importSource: AssociateImportSource;
};

export function isImportedAssociateMeta(
  meta?: AcafAssociateMeta | null,
): meta is SpreadsheetAcafAssociateMeta {
  if (!meta?.importSource) return false;
  return isAssociateImportSource(meta.importSource);
}

export function isAdminManualAssociateMeta(
  meta?: AcafAssociateMeta | null,
): meta is AcafAssociateMeta & { importSource: AdminManualAssociateSource } {
  return meta?.importSource === ADMIN_MANUAL_ASSOCIATE_SOURCE;
}
