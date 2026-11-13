import { ConnectFinanceSyncService } from './connect-finance-sync.service';
import { CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION } from './connect-finance-receivable';

jest.mock('../partner/store', () => ({
  loadStore: () => ({
    connectMembers: [
      {
        holderKey: 'maria',
        holderName: 'Maria',
        holderCpf: '39053344705',
        active: true,
        connectPlanId: 'connect-start',
      },
    ],
  }),
  updateStore: jest.fn((fn: (s: object) => void) => {
    const s = {
      connectMembers: [
        {
          holderKey: 'maria',
          holderName: 'Maria',
          holderCpf: '39053344705',
          active: true,
          connectPlanId: 'connect-start',
        },
      ],
    };
    fn(s);
    return s;
  }),
}));

describe('ConnectFinanceSyncService', () => {
  it('bloqueia sync quando há CPF mas userId não resolve', async () => {
    const receivableService = {
      upsertFromAsaasPayment: jest.fn(),
      relinkConnectReceivablesToUser: jest.fn(),
    };
    const payableService = {
      upsertGatewayFeeFromAsaasPayment: jest.fn(),
    };
    const usersService = {
      ensureConnectMemberUser: jest.fn().mockRejectedValue(new Error('falha')),
      findById: jest.fn(),
    };
    const transactionService = {
      syncFromConnectPayment: jest.fn(),
    };

    const svc = new ConnectFinanceSyncService(
      receivableService as never,
      payableService as never,
      usersService as never,
      transactionService as never,
    );

    const result = await svc.syncAsaasPayment({
      payment: { id: 'pay_x', status: 'CONFIRMED', value: 10 },
      holderName: 'Maria',
      holderKey: 'maria',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'teste',
    });

    expect(result.receivableId).toBeNull();
    expect(receivableService.upsertFromAsaasPayment).not.toHaveBeenCalled();
  });
});
