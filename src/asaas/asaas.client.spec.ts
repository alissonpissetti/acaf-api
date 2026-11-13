import { ConfigService } from '@nestjs/config';
import { AsaasClient, asaasPaymentSucceeded } from './asaas.client';

describe('AsaasClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function client(apiKey = 'key_test') {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ASAAS_API_KEY') return apiKey;
        if (key === 'ASAAS_API_URL') return 'https://api-sandbox.asaas.com/v3';
        return undefined;
      }),
    } as unknown as ConfigService;
    return new AsaasClient(config);
  }

  it('isConfigured reflete presença da chave', () => {
    expect(client('x').isConfigured()).toBe(true);
    expect(client('').isConfigured()).toBe(false);
  });

  it('createCustomer envia POST sem logar número do cartão', async () => {
    const asaas = client();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cus_1', name: 'Test' }),
    });
    global.fetch = fetchMock;

    const row = await asaas.createCustomer({
      name: 'Titular',
      cpfCnpj: '24971563792',
      email: 't@test.com',
      externalReference: 'titular',
    });

    expect(row.id).toBe('cus_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.cpfCnpj).toBe('24971563792');
    expect(JSON.stringify(body)).not.toMatch(/\d{13,}/);
  });

  it('propaga mensagens de erro do Asaas', async () => {
    const asaas = client();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [{ description: 'Cartão inválido' }],
      }),
    });

    await expect(
      asaas.createCreditCardSubscription({
        customerId: 'cus_1',
        value: 39.8,
        description: 'Plano',
        creditCard: {
          holderName: 'A',
          number: '4111111111111111',
          expiryMonth: '12',
          expiryYear: '2030',
          ccv: '123',
        },
        creditCardHolderInfo: {
          name: 'A',
          email: 'a@a.com',
          cpfCnpj: '24971563792',
          postalCode: '01310100',
          addressNumber: '1',
          phone: '47999999999',
        },
      }),
    ).rejects.toThrow('Cartão inválido');
  });
});

describe('asaasPaymentSucceeded', () => {
  it('reconhece status confirmados', () => {
    expect(asaasPaymentSucceeded('CONFIRMED')).toBe(true);
    expect(asaasPaymentSucceeded('pending')).toBe(false);
  });
});

describe('connectPaymentOutcomeFromAsaasStatus', () => {
  it('mapeia CONFIRMED/RECEIVED como confirmed e PENDING como pending_payment', () => {
    const { connectPaymentOutcomeFromAsaasStatus } = jest.requireActual('./asaas.client');
    expect(connectPaymentOutcomeFromAsaasStatus('CONFIRMED')).toBe('confirmed');
    expect(connectPaymentOutcomeFromAsaasStatus('RECEIVED')).toBe('confirmed');
    expect(connectPaymentOutcomeFromAsaasStatus('PENDING')).toBe('pending_payment');
    expect(connectPaymentOutcomeFromAsaasStatus('REFUSED')).toBe('failed');
  });
});
