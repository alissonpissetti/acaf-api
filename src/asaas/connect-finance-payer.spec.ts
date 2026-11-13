import { ConnectPayerUnresolvedError, resolveConnectReceivablePayer } from './connect-finance-payer';
import { UserRole } from '../users/user.entity';

describe('resolveConnectReceivablePayer', () => {
  it('vincula cliente pela chave normalizada do nome', async () => {
    const payer = await resolveConnectReceivablePayer(
      {
        find: jest.fn().mockResolvedValue([
          { id: 'user_1', name: 'Maria Silva', active: true, roles: [UserRole.MEMBER] },
        ]),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { holderName: 'Maria Silva', holderKey: 'maria silva' },
    );
    expect(payer).toEqual({ kind: 'client', refId: 'user_1', name: 'Maria Silva' });
  });

  it('vincula cliente pelo CPF quando existir na base', async () => {
    const payer = await resolveConnectReceivablePayer(
      {
        find: jest.fn(),
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ id: 'user_cpf', name: 'Alisson P', active: true, roles: [UserRole.MEMBER] }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { holderName: 'Outro Nome', holderKey: 'outro', cpf: '24971563792' },
    );
    expect(payer).toEqual({ kind: 'client', refId: 'user_cpf', name: 'Alisson P' });
  });

  it('prioriza userId do assinante quando informado', async () => {
    const userId = 'a1111111-1111-4111-8111-111111111111';
    const payer = await resolveConnectReceivablePayer(
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue({
          id: userId,
          name: 'Alisson P',
          active: true,
          roles: [UserRole.MEMBER],
        }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {
        holderName: 'Alisson P',
        holderKey: 'alisson p',
        platformUserId: userId,
      },
    );
    expect(payer).toEqual({ kind: 'client', refId: userId, name: 'Alisson P' });
  });

  it('rejeita holderKey como pagador quando CPF informado e usuário não existe', async () => {
    await expect(
      resolveConnectReceivablePayer(
        {
          find: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
        } as never,
        { find: jest.fn().mockResolvedValue([]) } as never,
        { holderName: 'João', holderKey: 'joao', cpf: '39053344705' },
      ),
    ).rejects.toBeInstanceOf(ConnectPayerUnresolvedError);
  });

  it('prioriza empresa corporativa quando informada', async () => {
    const payer = await resolveConnectReceivablePayer(
      {
        find: jest.fn().mockResolvedValue([]),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          { id: 'co_1', tradeName: 'ACME Fitness', legalName: 'ACME LTDA' },
        ]),
      } as never,
      { holderName: 'João', holderKey: 'joao', companyName: 'ACME Fitness' },
    );
    expect(payer).toEqual({ kind: 'company', refId: 'co_1', name: 'ACME Fitness' });
  });
});
