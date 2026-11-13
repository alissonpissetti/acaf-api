import {
  buildConnectAsaasCustomerExternalReference,
  buildConnectAsaasPaymentExternalReference,
  parseConnectAsaasUserIdFromReference,
  stripConnectAsaasUserRefSuffix,
} from './connect-asaas-external-ref';

describe('connect Asaas externalReference', () => {
  const userId = 'a1111111-1111-4111-8111-111111111111';

  it('monta e interpreta sufixo de userId', () => {
    const customerRef = buildConnectAsaasCustomerExternalReference('maria silva', userId);
    expect(customerRef).toBe(`maria silva#u=${userId}`);
    expect(parseConnectAsaasUserIdFromReference(customerRef)).toBe(userId);
    expect(stripConnectAsaasUserRefSuffix(customerRef)).toBe('maria silva');
  });

  it('mantém referência de pagamento legível após strip', () => {
    const paymentRef = buildConnectAsaasPaymentExternalReference('maria:connect-start', userId);
    expect(stripConnectAsaasUserRefSuffix(paymentRef)).toBe('maria:connect-start');
  });
});
