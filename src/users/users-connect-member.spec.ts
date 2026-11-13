import { UsersService } from './users.service';
import { UserRole } from './user.entity';

describe('UsersService.ensureConnectMemberUser', () => {
  function buildService(overrides?: {
    findByCpf?: jest.Mock;
    findByMobilePhone?: jest.Mock;
    findByEmail?: jest.Mock;
    save?: jest.Mock;
    create?: jest.Mock;
  }) {
    const users = {
      save: overrides?.save ?? jest.fn(async (row) => ({ ...row, id: 'user_new' })),
      create: overrides?.create ?? jest.fn((row) => row),
      findOne: jest.fn(),
    };

    const service = Object.create(UsersService.prototype) as UsersService;
    (service as unknown as { users: typeof users }).users = users;
    service.findByCpf = overrides?.findByCpf ?? jest.fn().mockResolvedValue(null);
    service.findByMobilePhone = overrides?.findByMobilePhone ?? jest.fn().mockResolvedValue(null);
    service.findByEmail = overrides?.findByEmail ?? jest.fn().mockResolvedValue(null);

    return { service, users };
  }

  it('cria cliente MEMBER com CPF e celular', async () => {
    const { service, users } = buildService();
    const id = await service.ensureConnectMemberUser({
      name: 'Alisson P',
      cpf: '24971563792',
      mobilePhone: '11999998888',
    });
    expect(id).toBe('user_new');
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: [UserRole.MEMBER],
        cpf: '24971563792',
        mobilePhone: '11999998888',
      }),
    );
  });

  it('reutiliza usuário existente pelo CPF', async () => {
    const existing = {
      id: 'user_existing',
      name: 'Antigo',
      cpf: '24971563792',
      mobilePhone: null,
      roles: [UserRole.MEMBER],
      active: true,
    };
    const { service } = buildService({
      findByCpf: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (row) => row),
    });
    const id = await service.ensureConnectMemberUser({
      name: 'Alisson P',
      cpf: '24971563792',
      mobilePhone: '11999998888',
    });
    expect(id).toBe('user_existing');
  });
});
