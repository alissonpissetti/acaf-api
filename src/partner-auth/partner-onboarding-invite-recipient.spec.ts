import {
  resolvePartnerContactName,
  resolvePartnerContactPhone,
} from './partner-onboarding-invite-recipient';
import type { AdminNetwork } from '../partner/types';

describe('resolvePartnerContactPhone', () => {
  const base: AdminNetwork = { id: 'n1', name: 'Rede' };

  it('aceita celular válido cadastrado no admin', () => {
    expect(resolvePartnerContactPhone({ ...base, partnerContactPhone: '11987654321' })).toBe(
      '11987654321',
    );
  });

  it('ignora telefone inválido ou ausente', () => {
    expect(resolvePartnerContactPhone({ ...base, partnerContactPhone: '1133334444' })).toBeNull();
    expect(resolvePartnerContactPhone(base)).toBeNull();
  });
});

describe('resolvePartnerContactName', () => {
  const base: AdminNetwork = { id: 'n1', name: 'Rede' };

  it('retorna nome com pelo menos 2 caracteres', () => {
    expect(resolvePartnerContactName({ ...base, partnerContactName: ' Maria ' })).toBe('Maria');
  });

  it('rejeita nome curto', () => {
    expect(resolvePartnerContactName({ ...base, partnerContactName: 'A' })).toBeNull();
  });
});