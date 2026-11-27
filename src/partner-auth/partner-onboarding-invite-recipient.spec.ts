import {
  formatContactEmailsForDisplay,
  parseContactEmailList,
  resolvePartnerContactName,
  resolvePartnerContactPhone,
  resolvePartnerOnboardingInviteRecipient,
} from './partner-onboarding-invite-recipient';
import type { AdminNetwork, GymUnit } from '../partner/types';

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

describe('parseContactEmailList', () => {
  it('divide e-mails separados por barra', () => {
    expect(
      parseContactEmailList(
        'luiz.almeida@ciaathletica.com.br / matheus.ferraz@ciaathletica.com.br',
      ),
    ).toEqual(['luiz.almeida@ciaathletica.com.br', 'matheus.ferraz@ciaathletica.com.br']);
  });

  it('ignora trechos inválidos e deduplica', () => {
    expect(parseContactEmailList('a@test.com / a@test.com , b@test.com')).toEqual([
      'a@test.com',
      'b@test.com',
    ]);
  });

  it('aceita um único e-mail', () => {
    expect(parseContactEmailList('  Resp@Acme.TEST ')).toEqual(['resp@acme.test']);
  });
});

describe('resolvePartnerOnboardingInviteRecipient', () => {
  const network: AdminNetwork = { id: 'net_1', name: 'Companhia Athletica' };
  const unit = {
    id: 'u1',
    networkId: 'net_1',
    acafAssociate: {
      contactEmail:
        'luiz.almeida@ciaathletica.com.br / matheus.ferraz@ciaathletica.com.br',
    },
  } as GymUnit;

  it('expõe vários destinatários a partir da planilha', () => {
    const resolved = resolvePartnerOnboardingInviteRecipient(network, [unit]);
    expect(resolved?.emails).toHaveLength(2);
    expect(resolved?.email).toBe(formatContactEmailsForDisplay(resolved!.emails));
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