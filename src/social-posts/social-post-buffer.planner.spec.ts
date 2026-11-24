import { planBufferUnits } from './social-post-buffer.planner';

describe('social-post-buffer.planner', () => {
  it('creates one feed unit per rede', () => {
    const units = planBufferUnits({
      envio: 'feed',
      redes: ['instagram', 'facebook'],
      artes: [
        { id: 'a1', ordem: 0, urlPublica: 'https://x/a1.jpg', interacao: null },
        { id: 'a2', ordem: 1, urlPublica: 'https://x/a2.jpg', interacao: null },
      ],
      legenda: 'Oi',
      hashtags: '#Movly',
      postLink: null,
    });
    expect(units).toHaveLength(2);
    expect(units[0]?.arteIds).toEqual(['a1', 'a2']);
  });

  it('returns no units when any arte blocks buffer (mesmo com outras sem interação)', () => {
    const units = planBufferUnits({
      envio: 'stories',
      redes: ['instagram'],
      artes: [
        { id: 'm1', ordem: 0, urlPublica: 'https://x/m1.jpg', interacao: 'manual' },
        { id: 'a1', ordem: 1, urlPublica: 'https://x/a1.jpg', interacao: null },
      ],
      legenda: null,
      hashtags: null,
      postLink: null,
    });
    expect(units).toHaveLength(0);
  });

  it('returns no units for link sticker (só app Meta)', () => {
    const units = planBufferUnits({
      envio: 'stories',
      redes: ['instagram'],
      artes: [{ id: 'l1', ordem: 0, urlPublica: 'https://x/l1.jpg', interacao: 'link' }],
      legenda: null,
      hashtags: null,
      postLink: 'https://gestao.sejamovly.com/f/go',
    });
    expect(units).toHaveLength(0);
  });
});