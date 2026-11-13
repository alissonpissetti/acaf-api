import { TransactionService } from './transaction.service';
import { CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION } from '../asaas/connect-finance-receivable';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RECEIVABLE_ID = '22222222-2222-4222-8222-222222222222';

describe('TransactionService', () => {
  function service() {
    const transactions: unknown[] = [];
    const attempts: unknown[] = [];
    const receivableUpdates: { id: string; transactionId: string }[] = [];

    const transactionsRepo = {
      findOne: jest.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.externalRef) {
          return transactions.find((t) => (t as { externalRef: string }).externalRef === where.externalRef) ?? null;
        }
        if (where.userId && where.asaasSubscriptionId) {
          return (
            transactions.find(
              (t) =>
                (t as { userId: string; asaasSubscriptionId: string }).userId === where.userId &&
                (t as { asaasSubscriptionId: string }).asaasSubscriptionId === where.asaasSubscriptionId,
            ) ?? null
          );
        }
        return null;
      }),
      create: jest.fn((row: object) => ({ id: 'tx-1', ...row })),
      save: jest.fn(async (row: { id?: string }) => {
        const saved = { id: row.id ?? 'tx-1', ...row };
        const idx = transactions.findIndex((t) => (t as { id: string }).id === saved.id);
        if (idx >= 0) transactions[idx] = saved;
        else transactions.push(saved);
        return saved;
      }),
      update: jest.fn(),
    };

    const attemptsRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((row: object) => row),
      save: jest.fn(async (row: object) => {
        attempts.push(row);
        return row;
      }),
    };

    const receivablesRepo = {
      update: jest.fn(async (_criteria: { id: string }, patch: { transactionId: string }) => {
        receivableUpdates.push({ id: _criteria.id, transactionId: patch.transactionId });
      }),
      find: jest.fn(),
    };

    return {
      svc: new TransactionService(
        transactionsRepo as never,
        attemptsRepo as never,
        receivablesRepo as never,
      ),
      transactionsRepo,
      attemptsRepo,
      receivableUpdates,
      transactions,
      attempts,
    };
  }

  it('cria transação por assinatura e vincula conta a receber', async () => {
    const { svc, receivableUpdates, attempts } = service();

    const transactionId = await svc.syncFromConnectPayment({
      payment: {
        id: 'pay_abc',
        status: 'CONFIRMED',
        subscription: 'sub_xyz',
        value: 49.9,
        billingType: 'CREDIT_CARD',
      },
      receivableId: RECEIVABLE_ID,
      userId: USER_ID,
      holderKey: 'maria',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'Assinatura Movly',
      webhookEvent: 'PAYMENT_CONFIRMED',
    });

    expect(transactionId).toBe('tx-1');
    expect(receivableUpdates).toEqual([{ id: RECEIVABLE_ID, transactionId: 'tx-1' }]);
    expect(attempts).toHaveLength(1);
    expect((attempts[0] as { asaasPaymentId: string }).asaasPaymentId).toBe('pay_abc');
  });

  it('reutiliza transação da mesma assinatura para parcela seguinte', async () => {
    const { svc, transactionsRepo } = service();

    await svc.syncFromConnectPayment({
      payment: { id: 'pay_1', status: 'CONFIRMED', subscription: 'sub_same', value: 10 },
      receivableId: 'recv_1',
      userId: USER_ID,
      holderKey: 'joao',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'Parcela 1',
    });

    transactionsRepo.findOne.mockClear();
    await svc.syncFromConnectPayment({
      payment: { id: 'pay_2', status: 'PENDING', subscription: 'sub_same', value: 10 },
      receivableId: 'recv_2',
      userId: USER_ID,
      holderKey: 'joao',
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: 'Parcela 2',
    });

    expect(transactionsRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, asaasSubscriptionId: 'sub_same' },
      }),
    );
  });

  it('cria transação de downgrade sem tentativa de gateway', async () => {
    const { svc, receivableUpdates } = service();

    const id = await svc.syncFromConnectDowngrade({
      receivableId: RECEIVABLE_ID,
      userId: USER_ID,
      holderKey: 'maria',
      amount: '15.00',
      description: 'Downgrade pró-rata',
    });

    expect(id).toBeTruthy();
    expect(receivableUpdates[0]?.transactionId).toBe('tx-1');
  });
});
