import { UsersService } from './users.service';

describe('UsersService.releaseConflictingPersonFieldsForPartnerOnboarding', () => {
  function buildService(input?: {
    phoneHolder?: { id: string; mobilePhone: string | null } | null;
    cpfHolder?: { id: string; cpf: string | null } | null;
  }) {
    const saved: unknown[] = [];
    const service = Object.create(UsersService.prototype) as UsersService;

    const users = {
      save: jest.fn(async (row: { id: string }) => {
        saved.push(row);
        return row;
      }),
    };
    (service as unknown as { users: typeof users }).users = users;
    service.findByMobilePhone = jest
      .fn()
      .mockResolvedValue(input?.phoneHolder ?? null);
    service.findByCpf = jest.fn().mockResolvedValue(input?.cpfHolder ?? null);

    return { service, saved };
  }

  it('libera celular em outra conta ao atualizar conta-alvo', async () => {
    const phoneHolder = { id: 'member-user', mobilePhone: '11987654321' as string | null };
    const { service, saved } = buildService({ phoneHolder });

    await service.releaseConflictingPersonFieldsForPartnerOnboarding(
      '24971563792',
      '11987654321',
      'partner-user',
    );

    expect(phoneHolder.mobilePhone).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('não altera o próprio usuário ao reutilizar o mesmo celular', async () => {
    const phoneHolder = { id: 'partner-user', mobilePhone: '11987654321' as string | null };
    const { service, saved } = buildService({ phoneHolder });

    await service.releaseConflictingPersonFieldsForPartnerOnboarding(
      '24971563792',
      '11987654321',
      'partner-user',
    );

    expect(phoneHolder.mobilePhone).toBe('11987654321');
    expect(saved).toHaveLength(0);
  });

  it('encontra titular de CPF/celular excluindo o usuário-alvo', async () => {
    const service = Object.create(UsersService.prototype) as UsersService;
    service.findByCpf = jest.fn().mockResolvedValue({ id: 'cpf-user' });
    service.findByMobilePhone = jest.fn().mockResolvedValue({ id: 'phone-user' });

    const result = await service.findPersonFieldHolderIds(
      '24971563792',
      '11987654321',
      'partner-user',
    );

    expect(result).toEqual({ cpfUserId: 'cpf-user', phoneUserId: 'phone-user' });
  });

  it('ignora conflito quando o titular é o próprio usuário', async () => {
    const service = Object.create(UsersService.prototype) as UsersService;
    service.findByCpf = jest.fn().mockResolvedValue({ id: 'same-user' });
    service.findByMobilePhone = jest.fn().mockResolvedValue({ id: 'same-user' });

    const result = await service.findPersonFieldHolderIds(
      '24971563792',
      '11987654321',
      'same-user',
    );

    expect(result).toEqual({ cpfUserId: null, phoneUserId: null });
  });
});
