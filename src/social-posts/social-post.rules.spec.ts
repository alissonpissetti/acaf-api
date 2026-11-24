import {
  assertCanScheduleOrPublish,
  assertRedesValidForEnvio,
  bufferPostingAllowed,
  classifyInteraction,
  defaultRedesForEnvio,
  deriveEtapaFromBufferStatuses,
  effectiveStatusesForEtapa,
  requiresManualPosting,
} from './social-post.rules';

describe('social-post.rules', () => {
  it('defaults redes by envio', () => {
    expect(defaultRedesForEnvio('feed')).toEqual(['instagram', 'facebook', 'linkedin']);
    expect(defaultRedesForEnvio('stories')).toEqual(['instagram', 'facebook']);
    expect(defaultRedesForEnvio('reels')).toEqual(['instagram']);
  });

  it('blocks linkedin on stories', () => {
    expect(() => assertRedesValidForEnvio('stories', ['linkedin'])).toThrow();
  });

  it('requires approval before schedule', () => {
    expect(() => assertCanScheduleOrPublish('pendente')).toThrow();
  });

  it('classifies manual stories', () => {
    expect(
      classifyInteraction('stories', [{ interacao: 'manual' }, { interacao: 'manual' }]),
    ).toBe('full_manual');
  });

  it('classifies mixed stories', () => {
    expect(
      classifyInteraction('stories', [{ interacao: 'manual' }, { interacao: null }]),
    ).toBe('mixed');
  });

  it('requires manual posting when arte has link or manual sticker', () => {
    expect(requiresManualPosting('stories', [{ interacao: null }])).toBe(false);
    expect(requiresManualPosting('feed', [{ interacao: 'link' }])).toBe(true);
    expect(requiresManualPosting('reels', [{ interacao: 'manual' }])).toBe(true);
    expect(bufferPostingAllowed('stories', [{ interacao: 'link' }])).toBe(false);
  });

  it('classifies all-link stories as full manual', () => {
    expect(classifyInteraction('stories', [{ interacao: 'link' }])).toBe('full_manual');
  });

  it('derives etapa from manual canal on one rede', () => {
    const statuses = effectiveStatusesForEtapa(
      ['instagram', 'facebook'],
      [
        { rede: 'instagram', status: 'sent', manual: true },
        { rede: 'facebook', status: 'draft', manual: true },
      ],
    );
    expect(deriveEtapaFromBufferStatuses(statuses, 'rascunho')).toBe('programado');
  });
});