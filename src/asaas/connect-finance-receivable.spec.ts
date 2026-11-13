import { CashEntryStatus } from '../finance/cash-entry.types';
import {
  asaasPaymentToReceivableFields,
  connectGatewayFeeAmount,
  connectPaymentCompensationDate,
  connectPaymentReceivableAmount,
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  CONNECT_PAYABLE_CATEGORY_GATEWAY_FEE,
} from './connect-finance-receivable';

describe('connect-finance-receivable', () => {
  describe('asaasPaymentToReceivableFields', () => {
    it('mapeia RECEIVED como quitado com creditDate', () => {
      const fields = asaasPaymentToReceivableFields({
        status: 'RECEIVED',
        creditDate: '2026-03-05',
        paymentDate: '2026-03-01',
      });
      expect(fields.status).toBe(CashEntryStatus.SETTLED);
      expect(fields.settledAt).toEqual(new Date('2026-03-01T12:00:00.000Z'));
      expect(fields.expectedSettledAt).toBe('2026-03-05');
    });

    it('mapeia CONFIRMED como quitado com execução e compensação futura', () => {
      const fields = asaasPaymentToReceivableFields({
        status: 'CONFIRMED',
        paymentDate: '2026-03-10',
        estimatedCreditDate: '2026-03-12',
      });
      expect(fields.status).toBe(CashEntryStatus.SETTLED);
      expect(fields.settledAt).toEqual(new Date('2026-03-10T12:00:00.000Z'));
      expect(fields.expectedSettledAt).toBe('2026-03-12');
    });

    it('em RECEIVED usa paymentDate como baixa e creditDate como compensação', () => {
      const fields = asaasPaymentToReceivableFields({
        status: 'RECEIVED',
        paymentDate: '2026-03-01',
        creditDate: '2026-03-05',
      });
      expect(fields.status).toBe(CashEntryStatus.SETTLED);
      expect(fields.settledAt).toEqual(new Date('2026-03-01T12:00:00.000Z'));
      expect(fields.expectedSettledAt).toBe('2026-03-05');
    });

    it('mapeia PENDING como pendente', () => {
      expect(asaasPaymentToReceivableFields({ status: 'PENDING' }).status).toBe(
        CashEntryStatus.PENDING,
      );
      expect(asaasPaymentToReceivableFields({ status: 'AUTHORIZED' }).status).toBe(
        CashEntryStatus.PENDING,
      );
    });

    it('mapeia OVERDUE e estornos', () => {
      expect(asaasPaymentToReceivableFields({ status: 'OVERDUE' }).status).toBe(
        CashEntryStatus.OVERDUE,
      );
      expect(asaasPaymentToReceivableFields({ status: 'REFUNDED' }).status).toBe(
        CashEntryStatus.CANCELLED,
      );
    });
  });

  describe('connectPaymentReceivableAmount / fee', () => {
    it('usa bruto por padrão e fee explícita', () => {
      const payment = { value: 39.8, netValue: 38.5, fee: 1.3 };
      expect(connectPaymentReceivableAmount(payment, false)).toBe('39.80');
      expect(connectPaymentReceivableAmount(payment, true)).toBe('38.50');
      expect(connectGatewayFeeAmount(payment)).toBe(1.3);
    });

    it('deriva fee de bruto − líquido', () => {
      expect(connectGatewayFeeAmount({ value: 100, netValue: 96.01 })).toBe(3.99);
    });

    it('resolve data de compensação', () => {
      expect(
        connectPaymentCompensationDate({
          creditDate: '2026-04-01',
          estimatedCreditDate: '2026-04-10',
        }),
      ).toBe('2026-04-01');
      expect(
        connectPaymentCompensationDate({
          estimatedCreditDate: '2026-04-10',
          dueDate: '2026-04-05',
        }),
      ).toBe('2026-04-10');
    });
  });

  it('expõe categorias da assinatura', () => {
    expect(CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION).toBe('connect_subscription');
    expect(CONNECT_PAYABLE_CATEGORY_GATEWAY_FEE).toBe('connect_gateway_fee');
  });
});
