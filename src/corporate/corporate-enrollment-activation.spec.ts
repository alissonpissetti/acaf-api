import { CorporateEmployeesService } from './corporate-employees.service';

describe('CorporateEmployeesService.completeAppEnrollmentActivation', () => {
  function buildService(overrides?: {
    employeeRow?: { status: string; activatedAt: Date | null };
  }) {
    const row = overrides?.employeeRow ?? { status: 'invited', activatedAt: null };
    const saved: Array<Record<string, unknown>> = [];

    const employees = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          status: row.status,
          activatedAt: row.activatedAt,
          user: { name: 'Vanessa', email: 'vanessa@example.com', cpf: '12345678901' },
        }),
      })),
      save: jest.fn(async (entity) => {
        saved.push(entity);
        return entity;
      }),
    };

    const service = Object.create(CorporateEmployeesService.prototype) as CorporateEmployeesService;
    (service as unknown as { employees: typeof employees }).employees = employees;

    service.verifyAppEnrollmentActivation = jest.fn().mockResolvedValue({
      collaboratorName: 'Vanessa',
      email: 'vanessa@example.com',
    });

    return { service, employees, saved };
  }

  it('promove colaborador de invited para active após validação no app', async () => {
    const { service, employees, saved } = buildService();
    await service.completeAppEnrollmentActivation('company-1', '123.456.789-01');
    expect(employees.save).toHaveBeenCalledTimes(1);
    expect(saved[0]?.status).toBe('active');
    expect(saved[0]?.activatedAt).toBeInstanceOf(Date);
  });

  it('não altera colaborador já active', async () => {
    const { service, employees } = buildService({
      employeeRow: { status: 'active', activatedAt: new Date('2026-01-01') },
    });
    await service.completeAppEnrollmentActivation('company-1', '12345678901');
    expect(employees.save).not.toHaveBeenCalled();
  });

  it('relaciona userId do app ao colaborador quando informado', async () => {
    const row = {
      status: 'invited',
      activatedAt: null,
      userId: 'hr-user',
      user: { name: 'Vanessa', email: 'vanessa@example.com', cpf: '12345678901' },
    };
    const saved: Array<Record<string, unknown>> = [];
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'app-user', cpf: '12345678901' }),
    };
    const employees = {
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(row),
      })),
      save: jest.fn(async (entity) => {
        saved.push(entity);
        return entity;
      }),
    };

    const service = Object.create(CorporateEmployeesService.prototype) as CorporateEmployeesService;
    (service as unknown as { employees: typeof employees }).employees = employees;
    (service as unknown as { users: typeof users }).users = users;

    service.verifyAppEnrollmentActivation = jest.fn().mockResolvedValue({
      collaboratorName: 'Vanessa',
      email: 'vanessa@example.com',
    });

    await service.completeAppEnrollmentActivation('company-1', '12345678901', {
      platformUserId: 'app-user',
    });

    expect(saved[0]?.userId).toBe('app-user');
    expect(saved[0]?.status).toBe('active');
  });
});