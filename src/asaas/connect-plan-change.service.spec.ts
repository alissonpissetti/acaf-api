import { BadRequestException } from '@nestjs/common';
import { ConnectPlanChangeService } from './connect-plan-change.service';
import { AsaasClient } from './asaas.client';

const upsertConnectSubscription = jest.fn();
const getConnectMemberProfile = jest.fn();

const mockMember = {
  holderKey: 'titular-teste',
  holderName: 'Titular Teste',
  connectPlanId: 'connect-start' as const,
  active: true,
  since: new Date().toISOString(),
  asaasCustomerId: 'cus_1',
  asaasSubscriptionId: 'sub_1',
  cardLastFour: '8829',
};

jest.mock('../partner/store', () => ({
  getDomain: () => ({
    connectPlans: [
      { id: 'connect-start', name: 'Start', pricePerMonth: 39.8 },
      { id: 'connect-plus', name: 'Plus', pricePerMonth: 69.9 },
    ],
  }),
  loadStore: () => ({ connectMembers: [mockMember] }),
  updateStore: jest.fn((fn) => {
    const s = { connectMembers: [{ ...mockMember }] };
    fn(s);
    return s;
  }),
}));

jest.mock('../partner/connectMember', () => ({
  findConnectMember: jest.fn(() => mockMember),
  getConnectMemberProfile: (...args: unknown[]) => getConnectMemberProfile(...args),
  toConnectMemberProfile: jest.fn((member: typeof mockMember) => ({
    holderKey: member.holderKey,
    holderName: member.holderName,
    connectPlanId: member.connectPlanId,
    active: member.active,
    since: member.since,
    primaryUnitId: null,
    primaryUnitName: null,
    primaryChosenAt: null,
    primaryFirstCheckInAt: null,
    primaryCheckInsSinceFirst: 0,
    canChangePrimary: true,
    remainingCheckInsBeforeChange: 0,
    minCheckInsToChange: 12,
    asaasSubscriptionId: member.asaasSubscriptionId,
    cardLastFour: member.cardLastFour,
  })),
  upsertConnectSubscription: (...args: unknown[]) => upsertConnectSubscription(...args),
}));

describe('ConnectPlanChangeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConnectMemberProfile.mockReturnValue({
      holderName: 'Titular Teste',
      connectPlanId: 'connect-start',
      active: true,
      since: mockMember.since,
    });
    upsertConnectSubscription.mockReturnValue({
      holderName: 'Titular Teste',
      connectPlanId: 'connect-plus',
      active: true,
      since: mockMember.since,
    });
  });

  function service(paymentStatuses: string[]) {
    let poll = 0;
    const asaas = {
      isConfigured: jest.fn(() => true),
      createCustomerCreditCardPayment: jest
        .fn()
        .mockResolvedValue({ id: 'pay_upgrade', status: paymentStatuses[0] ?? 'PENDING' }),
      getPayment: jest.fn().mockImplementation(() => {
        const status = paymentStatuses[Math.min(poll, paymentStatuses.length - 1)] ?? 'PENDING';
        poll += 1;
        return Promise.resolve({ id: 'pay_upgrade', status });
      }),
      updateSubscription: jest.fn().mockResolvedValue({ id: 'sub_1' }),
    } as unknown as AsaasClient;

    const connectFinance = {
      syncAsaasPayment: jest.fn().mockResolvedValue({ receivableId: 'recv_1', payableId: null }),
      createDowngradeReceivable: jest.fn().mockResolvedValue('recv_downgrade'),
    };

    return {
      service: new ConnectPlanChangeService(asaas, connectFinance as never),
      asaas,
      connectFinance,
    };
  }

  it(
    'não altera o plano quando cobrança do upgrade permanece PENDING',
    async () => {
      jest.useFakeTimers();
      const { service: planChange, asaas, connectFinance } = service(['PENDING', 'PENDING', 'PENDING']);

      const changePromise = planChange.changePlan({
        holderName: 'Titular Teste',
        connectPlanId: 'connect-plus',
      });
      await jest.runAllTimersAsync();
      const result = await changePromise;
      jest.useRealTimers();

    expect(result.payment?.outcome).toBe('pending_payment');
    expect(result.payment?.id).toBe('pay_upgrade');
    expect(result.profile.connectPlanId).toBe('connect-start');
    expect(upsertConnectSubscription).not.toHaveBeenCalled();
    expect(asaas.updateSubscription).not.toHaveBeenCalled();
      expect(connectFinance.syncAsaasPayment).not.toHaveBeenCalled();
    },
    15_000,
  );

  it('confirma upgrade e altera plano quando pagamento CONFIRMED', async () => {
    const { service: planChange, asaas, connectFinance } = service(['CONFIRMED']);

    const result = await planChange.changePlan({
      holderName: 'Titular Teste',
      connectPlanId: 'connect-plus',
    });

    expect(result.payment?.outcome).toBe('confirmed');
    expect(upsertConnectSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ connectPlanId: 'connect-plus' }),
    );
    expect(asaas.updateSubscription).toHaveBeenCalled();
    expect(connectFinance.syncAsaasPayment).toHaveBeenCalled();
  });

  it('rejeita upgrade quando pagamento falha', async () => {
    const { service: planChange } = service(['REFUSED']);

    await expect(
      planChange.changePlan({
        holderName: 'Titular Teste',
        connectPlanId: 'connect-plus',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(upsertConnectSubscription).not.toHaveBeenCalled();
  });

  it('downgrade confirma sem cobrança (receivable interno)', async () => {
    const memberPlus = { ...mockMember, connectPlanId: 'connect-plus' as const };
    const { findConnectMember } = jest.requireMock('../partner/connectMember');
    findConnectMember.mockReturnValue(memberPlus);

    const asaas = {
      isConfigured: jest.fn(() => true),
      updateSubscription: jest.fn().mockResolvedValue({ id: 'sub_1' }),
    } as unknown as AsaasClient;
    const connectFinance = {
      syncAsaasPayment: jest.fn(),
      createDowngradeReceivable: jest.fn().mockResolvedValue('recv_down'),
    };
    const planChange = new ConnectPlanChangeService(asaas, connectFinance as never);

    const result = await planChange.changePlan({
      holderName: 'Titular Teste',
      connectPlanId: 'connect-start',
    });

    expect(result.change.kind).toBe('downgrade');
    expect(result.payment?.outcome).toBe('confirmed');
    expect(upsertConnectSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ connectPlanId: 'connect-start' }),
    );
    expect(connectFinance.createDowngradeReceivable).toHaveBeenCalled();
  });
});
