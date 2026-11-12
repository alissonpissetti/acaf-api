import type { AcafAssociateMeta } from './types';

/** Fontes conhecidas de importação de associados (planilha). */
export const ASSOCIATE_IMPORT_SOURCES = ['acaf_associates_xlsx', 'associates_xlsx'] as const;
export type AssociateImportSource = (typeof ASSOCIATE_IMPORT_SOURCES)[number];

export function isAssociateImportSource(value: string): value is AssociateImportSource {
  return (ASSOCIATE_IMPORT_SOURCES as readonly string[]).includes(value);
}

export function isImportedAssociateMeta(meta?: AcafAssociateMeta | null): meta is AcafAssociateMeta {
  if (!meta?.importSource) return false;
  return isAssociateImportSource(meta.importSource);
}
