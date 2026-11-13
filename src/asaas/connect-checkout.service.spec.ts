import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectCheckoutService } from './connect-checkout.service';
import { AsaasClient } from './asaas.client';

jest.mock('../partner/store', () => ({
  getDomain: () => ({
    connectPlans: [{ id: 'connect-start', name: 'Start', pricePerMonth: 39.8 }],
  }),
  loadStore: () => ({ connectMembers: [] }),
}));

jest.mock('../partner/connectMember', () => ({
  upsertConnectSubscription: jest.fn(() => ({
    holderName: 'Titular',
    connectPlanId: 'connect-start',
    active: true,
    since: new Date().toISOString(),
    asaasSubscriptionId: 'sub_test',
    cardLastFour: '8829',
  })),
}));

describe('ConnectCheckoutService', () => {
  function service(options: { sandbox?: boolean; asaasConfigured?: boolean }) {
    const { sandbox = true, asaasConfigured = true } = options;
    const asaas = {
      isConfigured: jest.fn(() => asaasConfigured),
      findCustomerByExternalReference: jest.fn().mockResolvedValue(null),
      createCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
      updateCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
      createCreditCardSubscription: jest.fn().mockResolvedValue({ id: 'sub_test' }),
      listSubscriptionPayments: jest
        .fn()
        .mockResolvedValue([{ id: 'pay_1', status: 'CONFIRMED' }]),
    } as unknown as AsaasClient;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ASAAS_API_URL') {
          return sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    const connectFinance = {
      syncAsaasPayment: jest.fn().mockResolvedValue({ receivableId: 'recv_test', payableId: null }),
      syncSubscriptionPayments: jest.fn().mockResolvedValue(undefined),
    };

    const receivableFinance = {
      relinkConnectReceivablesToUser: jest.fn().mockResolvedValue(0),
    };

    const usersService = {
      ensureConnectMemberUser: jest.fn().mockResolvedValue('user_checkout'),
      findById: jest.fn().mockResolvedValue({ id: 'user_checkout', name: 'Teste Asaas' }),
    };

    return {
      service: new ConnectCheckoutService(
        asaas,
        config,
        connectFinance as never,
        receivableFinance as never,
        usersService as never,
      ),
      asaas,
      connectFinance,
      usersService,
    };
  }

  const cardInput = {
    holderName: 'Teste Asaas',
    connectPlanId: 'connect-start' as const,
    holderPhone: '47991234567',
    card: {
      holderName: 'Teste Asaas',
      number: '5162306219378829',
      expiryMonth: '12',
      expiryYear: '28',
      cvv: '318',
    },
  };

  it('usa CPF de sandbox quando URL é sandbox e titular não informou CPF', async () => {
    const { service: checkout, asaas } = service({ sandbox: true });
    await checkout.checkout(cardInput);

    expect(asaas.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ cpfCnpj: '24971563792' }),
    );
  });

  it('cria conta a receber após pagamento confirmado', async () => {
    const { service: checkout, connectFinance } = service({ sandbox: true });
    await checkout.checkout(cardInput);

    expect(connectFinance.syncAsaasPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'connect_subscription',
        holderName: 'Teste Asaas',
      }),
    );
  });

  it('exige CPF em ambiente de produção sem fallback', async () => {
    const { service: checkout } = service({ sandbox: false });
    await expect(checkout.checkout(cardInput)).rejects.toThrow(BadRequestException);
    await expect(checkout.checkout(cardInput)).rejects.toThrow(/CPF/);
  });

  it('converte erro do Asaas em BadRequestException', async () => {
    const { service: checkout, asaas } = service({ sandbox: true });
    (asaas.createCustomer as jest.Mock).mockRejectedValue(new Error('Cartão inválido'));

    await expect(checkout.checkout(cardInput)).rejects.toThrow(BadRequestException);
    await expect(checkout.checkout(cardInput)).rejects.toThrow('Cartão inválido');
  });

  it('rejeita celular inválido antes de chamar o Asaas', async () => {
    const { service: checkout, asaas } = service({ sandbox: true });
    await expect(
      checkout.checkout({ ...cardInput, holderPhone: '123' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      checkout.checkout({ ...cardInput, holderPhone: '123' }),
    ).rejects.toThrow(/celular válido/i);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });

  it('rejeita CPF inválido informado pelo titular', async () => {
    const { service: checkout, asaas } = service({ sandbox: true });
    await expect(
      checkout.checkout({ ...cardInput, holderCpf: '11111111111' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      checkout.checkout({ ...cardInput, holderCpf: '11111111111' }),
    ).rejects.toThrow(/CPF/);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
});
