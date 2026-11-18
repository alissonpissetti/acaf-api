import { loadStore } from '../partner/store';
import type { User } from '../users/user.entity';
import { CorporateEmployeesService } from './corporate-employees.service';

jest.mock('../partner/store', () => ({
  loadStore: jest.fn(),
  getDomain: jest.fn(() => ({})),
}));

describe('CorporateEmployeesService.reconcilePendingEmployeesForPlatformUser', () => {
  it('ativa colaborador pendente quando o titular corporativo já está ativo no app', async () => {
    (loadStore as jest.Mock).mockReturnValue({
      connectMembers: [
        {
          holderKey: 'alisson',
          holderName: 'Alisson Pissetti',
          active: true,
          userId: 'app-user',
          holderCpf: '12345678901',
          holderEmail: 'cliente@sejamovly.com',
          companyName: 'Formô Brasil PR',
          connectPlanId: 'plus',
          corporateBenefitPerMonth: 44.9,
        },
      ],
      units: [],
    });

    const save = jest.fn(async (entity) => entity);
    const employees = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'emp-1',
          status: 'invited',
          userId: 'hr-user',
          activatedAt: null,
          user: {
            id: 'hr-user',
            name: 'Alisson',
            email: 'galoveio@gmail.com',
            cpf: '12345678901',
          },
        }),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'emp-1',
            status: 'invited',
            userId: 'hr-user',
            activatedAt: null,
            user: {
              id: 'hr-user',
              name: 'Alisson',
              email: 'galoveio@gmail.com',
              cpf: '12345678901',
            },
            company: {
              id: 'company-1',
              tradeName: 'Formô Brasil PR',
              legalName: 'Formô Brasil PR',
            },
          },
        ]),
      })),
      save,
    };

    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'app-user', cpf: '12345678901' }),
    };

    const service = Object.create(CorporateEmployeesService.prototype) as CorporateEmployeesService;
    (service as unknown as { employees: typeof employees }).employees = employees;
    (service as unknown as { users: typeof users }).users = users;
    service.verifyAppEnrollmentActivation = jest.fn().mockResolvedValue({
      collaboratorName: 'Alisson',
      email: 'galoveio@gmail.com',
    });

    const platformUser = {
      id: 'app-user',
      name: 'Alisson Pissetti',
      email: 'cliente@sejamovly.com',
      cpf: '12345678901',
    } as User;

    await service.reconcilePendingEmployeesForPlatformUser(platformUser);

    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls[0]?.[0] as { status: string; userId: string };
    expect(saved.status).toBe('active');
    expect(saved.userId).toBe('app-user');
  });
});