import {
  asaasPaymentToBillingStatus,
  mapSubscriptionPaymentToStatementEntry,
} from './connect-billing';

describe('connect-billing', () => {
  it('maps Asaas statuses to billing statement status', () => {
    expect(asaasPaymentToBillingStatus('CONFIRMED')).toBe('paid');
    expect(asaasPaymentToBillingStatus('PENDING')).toBe('pending');
    expect(asaasPaymentToBillingStatus('OVERDUE')).toBe('failed');
  });

  it('builds statement entry from subscription payment', () => {
    const row = mapSubscriptionPaymentToStatementEntry({
      payment: {
        id: 'pay_123',
        status: 'PENDING',
        value: 129.9,
        dueDate: '2026-03-10',
      },
      planName: 'Multi',
      cardLastFour: '1111',
    });
    expect(row).toMatchObject({
      id: 'pay_123',
      description: 'Mensalidade Multi',
      amount: 129.9,
      status: 'pending',
      cardLastFour: '1111',
    });
    expect(row.occurredAt).toContain('2026-03-10');
  });
});
