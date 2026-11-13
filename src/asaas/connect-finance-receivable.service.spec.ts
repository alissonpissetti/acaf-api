import { ConfigService } from '@nestjs/config';
import { ConnectFinanceReceivableService } from './connect-finance-receivable.service';
import { CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION } from './connect-finance-receivable';
import { CashEntryStatus } from '../finance/cash-entry.types';
import { UserRole } from '../users/user.entity';

const MARIA_USER_ID = 'b2222222-2222-4222-8222-222222222222';

describe('ConnectFinanceReceivableService', () => {
  function serviceWithRepos() {
    const saved: Record<string, unknown>[] = [];
    const receivables = {
      findOne: jest.fn(async ({ where }: { where: { asaasPaymentId?: string } }) =>
        saved.find((row) => row.asaasPaymentId === where.asaasPaymentId) ?? null,
      ),
      create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
      save: jest.fn(async (row: Record<string, unknown> & { id?: string }) => {
        if (row.id) {
          const idx = saved.findIndex((r) => r.id === row.id);
          if (idx >= 0) saved[idx] = row;
          return row;
        }
        const withId = { ...row, id: `recv_${saved.length + 1}` };
        saved.push(withId);
        return withId;
      }),
    };

    const costCenters = {
      findOne: jest.fn().mockResolvedValue({ id: 'cc_default' }),
    };
    const accountPlans = {
      findOne: jest.fn().mockResolvedValue({ id: 'ap_default' }),
    };
    const platformUsers = {
      find: jest.fn().mockResolvedValue([
        { id: MARIA_USER_ID, name: 'Maria', active: true, roles: [UserRole.MEMBER] },
      ]),
    };
    const companies = {
      find: jest.fn().mockResolvedValue([]),
    };

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'CONNECT_FINANCE_COST_CENTER_ID') return 'cc_env';
        if (key === 'CONNECT_FINANCE_ACCOUNT_PLAN_ID') return 'ap_env';
        return undefined;
      }),
    } as unknown as ConfigService;

    const svc = new ConnectFinanceReceivableService(
      config,
      receivables as never,
      costCenters as never,
      accountPlans as never,
      platformUsers as never,
      companies as never,
    );

    return { svc, receivables, saved };
  }

  it('cria conta a receber idempotente por asaasPaymentId', async () => {
    const { svc, receivables, saved } = serviceWithRepos();

    const payment = {
      id: 'pay_abc',
      status: 'CONFIRMED',
      value: 39.8,
      dueDate: '2026-03-10',
      paymentDate: '2026-03-09',
      estimatedCreditDate: '2026-03-15',
      fee: 1.2,
    };

    const id1 = await svc.upsertFromAsaasPayment({
      payment,
      holderName: 'Maria',
      holderKey: 'maria',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'Movly — Start — Maria',
    });
    const id2 = await svc.upsertFromAsaasPayment({
      payment: { ...payment, status: 'RECEIVED', creditDate: '2026-03-15' },
      holderName: 'Maria',
      holderKey: 'maria',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'Movly — Start — Maria',
    });

    expect(id1).toBe(id2);
    expect(saved).toHaveLength(1);
    expect(receivables.save).toHaveBeenCalledTimes(2);
    expect(saved[0].status).toBe(CashEntryStatus.SETTLED);
    expect(saved[0].expectedSettledAt).toBe('2026-03-15');
    expect(saved[0].payerRefId).toBe(MARIA_USER_ID);
    expect(saved[0].platformUserId).toBe(MARIA_USER_ID);
    expect(saved[0].connectHolderKey).toBe('maria');
    expect(saved[0].asaasPaymentId).toBe('pay_abc');
    expect(saved[0].costCenterId).toBe('cc_env');
  });
});
