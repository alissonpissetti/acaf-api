import type { GymUnit, ModalitySlotOverride, ModalitySlotTemplate } from './types';

export function sortInstructorNames(names: string[]): string[] {
  return [...names]
    .map((n) => n.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function collectInstructorNames(
  templates: ModalitySlotTemplate[],
  overrides: ModalitySlotOverride[],
  existing: string[] = [],
): string[] {
  const set = new Set(sortInstructorNames(existing));
  for (const row of templates) {
    const name = row.instructorName?.trim();
    if (name) set.add(name);
  }
  for (const row of overrides) {
    const name = row.instructorName?.trim();
    if (name) set.add(name);
  }
  return sortInstructorNames([...set]);
}

export function mergeInstructorRegistry(
  unit: GymUnit,
  templates: ModalitySlotTemplate[],
  overrides: ModalitySlotOverride[],
  extra: string[] = [],
): string[] {
  return collectInstructorNames(templates, overrides, [
    ...(unit.instructors ?? []),
    ...extra,
  ]);
}
