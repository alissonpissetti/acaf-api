import {
  canonicalEnrollmentCode,
  enrollmentCodeLookupKeys,
  generateEnrollmentCode,
  normalizeEnrollmentCode,
  slugFromTradeName,
} from './enrollment-code';

describe('enrollment-code', () => {
  it('slugFromTradeName usa nome fantasia simples', () => {
    expect(slugFromTradeName('Tagsa')).toBe('TAGSA');
    expect(slugFromTradeName('Carpe Diem')).toBe('CARPEDIEM');
  });

  it('slugFromTradeName ignora sufixos societários e prefixos genéricos', () => {
    expect(slugFromTradeName('Academia Carpe Diem Ltda')).toBe('CARPEDIEM');
    expect(slugFromTradeName('Empresa XYZ S.A.')).toBe('XYZ');
  });

  it('generateEnrollmentCode adiciona sufixo numérico em colisão', () => {
    expect(generateEnrollmentCode('Tagsa', 0)).toBe('TAGSA');
    expect(generateEnrollmentCode('Tagsa', 1)).toBe('TAGSA2');
    expect(generateEnrollmentCode('Tagsa', 2)).toBe('TAGSA3');
  });

  it('normalizeEnrollmentCode preserva códigos legados com hífen', () => {
    expect(normalizeEnrollmentCode('  tagsa-67d5a1 ')).toBe('TAGSA-67D5A1');
  });

  it('canonicalEnrollmentCode remove pontuação', () => {
    expect(canonicalEnrollmentCode('carpe-diem')).toBe('CARPEDIEM');
    expect(canonicalEnrollmentCode('TAGSA-67D5A1')).toBe('TAGSA67D5A1');
  });

  it('enrollmentCodeLookupKeys aceita digitação flexível', () => {
    expect(enrollmentCodeLookupKeys('carpe diem')).toEqual(['CARPEDIEM']);
    expect(enrollmentCodeLookupKeys('TAGSA-67D5A1')).toEqual(['TAGSA-67D5A1', 'TAGSA67D5A1']);
  });
});
