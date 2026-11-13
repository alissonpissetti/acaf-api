import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AsaasPayment } from '../asaas/asaas.types';
import {
  asaasPaymentPending,
  asaasPaymentSucceeded,
} from '../asaas/asaas.client';
import type { ConnectReceivableCategory } from '../asaas/connect-finance-receivable';
import {
  CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE,
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
} from '../asaas/connect-finance-receivable';
import { isPlatformUserUuid } from '../asaas/connect-checkout-identity';
import { AccountReceivable } from './account-receivable.entity';
import { TransactionGatewayAttempt } from './transaction-gateway-attempt.entity';
import { Transaction } from './transaction.entity';
import { TransactionStatus, type TransactionKind } from './transaction.types';

export type SyncConnectPaymentTransactionInput = {
  payment: AsaasPayment;
  receivableId: string;
  userId: string;
  holderKey: string;
  category: ConnectReceivableCategory;
  description: string;
  webhookEvent?: string | null;
};

export type SyncConnectDowngradeTransactionInput = {
  receivableId: string;
  userId: string;
  holderKey: string;
  amount: string;
  description: string;
};

function categoryToKind(category: ConnectReceivableCategory): TransactionKind {
  switch (category) {
    case CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION:
      return 'connect_subscription';
    case CONNECT_RECEIVABLE_CATEGORY_UPGRADE:
      return 'connect_plan_upgrade';
    case CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE:
      return 'connect_plan_downgrade';
    default:
      return 'connect_one_off';
  }
}

function gatewayStatusToTransactionStatus(paymentStatus: string | undefined): TransactionStatus {
  const status = (paymentStatus ?? '').toUpperCase();
  if (asaasPaymentSucceeded(status)) return TransactionStatus.COMPLETED;
  if (asaasPaymentPending(status)) return TransactionStatus.IN_PROGRESS;
  if (status === 'OVERDUE') return TransactionStatus.IN_PROGRESS;
  if (status === 'REFUNDED' || status === 'DELETED') return TransactionStatus.CANCELLED;
  return TransactionStatus.FAILED;
}

@Injectable()
export class TransactionService {
  private readonly log = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionGatewayAttempt)
    private readonly attempts: Repository<TransactionGatewayAttempt>,
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
  ) {}

  async listForUser(userId: string): Promise<Transaction[]> {
    return this.transactions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: ['gatewayAttempts'],
    });
  }

  async getById(id: string): Promise<{
    transaction: Transaction;
    receivables: AccountReceivable[];
    gatewayAttempts: TransactionGatewayAttempt[];
  }> {
    const transaction = await this.transactions.findOne({ where: { id } });
    if (!transaction) throw new NotFoundException('Transação não encontrada.');

    const [receivables, gatewayAttempts] = await Promise.all([
      this.receivables.find({
        where: { transactionId: id },
        order: { dueDate: 'ASC' },
      }),
      this.attempts.find({
        where: { transactionId: id },
        order: { statusAt: 'DESC' },
      }),
    ]);

    return { transaction, receivables, gatewayAttempts };
  }

  async syncFromConnectPayment(input: SyncConnectPaymentTransactionInput): Promise<string | null> {
    const userId = input.userId.trim();
    if (!isPlatformUserUuid(userId)) return null;

    const paymentId = input.payment.id?.trim();
    if (!paymentId) return null;

    const subscriptionId = input.payment.subscription?.trim() || null;
    const holderKey = input.holderKey.trim().toLowerCase();
    const kind = categoryToKind(input.category);
    const amount = Number(input.payment.value ?? 0);
    const amountTotal = (amount > 0 ? amount : 0.01).toFixed(2);

    const externalRef = subscriptionId
      ? `asaas:subscription:${subscriptionId}`
      : `asaas:payment:${paymentId}`;

    let transaction =
      (subscriptionId
        ? await this.transactions.findOne({
            where: { userId, asaasSubscriptionId: subscriptionId },
          })
        : null) ??
      (await this.transactions.findOne({ where: { externalRef } }));

    if (!transaction) {
      transaction = await this.transactions.save(
        this.transactions.create({
          userId,
          kind,
          status: gatewayStatusToTransactionStatus(input.payment.status),
          amountTotal,
          currency: 'BRL',
          description: input.description,
          metadata: {
            connectCategory: input.category,
            holderKey,
          },
          partnerUnitId: null,
          connectHolderKey: holderKey || null,
          asaasSubscriptionId: subscriptionId,
          externalRef,
        }),
      );
    } else {
      transaction.kind = kind;
      transaction.description = input.description;
      transaction.connectHolderKey = holderKey || transaction.connectHolderKey;
      if (!transaction.asaasSubscriptionId && subscriptionId) {
        transaction.asaasSubscriptionId = subscriptionId;
      }
      if (Number(transaction.amountTotal) < amount) {
        transaction.amountTotal = amountTotal;
      }
      transaction.status = this.aggregateTransactionStatus(
        transaction.status,
        gatewayStatusToTransactionStatus(input.payment.status),
      );
      await this.transactions.save(transaction);
    }

    await this.recordGatewayAttempt({
      transactionId: transaction.id,
      payment: input.payment,
      webhookEvent: input.webhookEvent,
    });

    await this.receivables.update({ id: input.receivableId }, { transactionId: transaction.id });

    return transaction.id;
  }

  async syncFromConnectDowngrade(input: SyncConnectDowngradeTransactionInput): Promise<string | null> {
    const userId = input.userId.trim();
    if (!isPlatformUserUuid(userId)) return null;

    const holderKey = input.holderKey.trim().toLowerCase();
    const externalRef = `connect:downgrade:${input.receivableId}`;

    let transaction = await this.transactions.findOne({ where: { externalRef } });
    if (!transaction) {
      transaction = await this.transactions.save(
        this.transactions.create({
          userId,
          kind: 'connect_plan_downgrade',
          status: TransactionStatus.PENDING,
          amountTotal: input.amount,
          currency: 'BRL',
          description: input.description,
          metadata: { connectCategory: CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE, holderKey },
          partnerUnitId: null,
          connectHolderKey: holderKey || null,
          asaasSubscriptionId: null,
          externalRef,
        }),
      );
    }

    await this.receivables.update({ id: input.receivableId }, { transactionId: transaction.id });
    return transaction.id;
  }

  private async recordGatewayAttempt(input: {
    transactionId: string;
    payment: AsaasPayment;
    webhookEvent?: string | null;
  }): Promise<void> {
    const paymentId = input.payment.id?.trim();
    if (!paymentId) return;

    const status = (input.payment.status ?? 'UNKNOWN').toUpperCase();
    const amount = input.payment.value != null ? Number(input.payment.value).toFixed(2) : null;
    const now = new Date();

    const existing = await this.attempts.findOne({ where: { asaasPaymentId: paymentId } });
    if (existing) {
      existing.status = status;
      existing.statusAt = now;
      existing.paymentMethod = input.payment.billingType?.trim() || existing.paymentMethod;
      existing.amount = amount ?? existing.amount;
      if (input.webhookEvent?.trim()) {
        existing.webhookEvent = input.webhookEvent.trim();
      }
      existing.metadata = {
        ...(existing.metadata ?? {}),
        dueDate: input.payment.dueDate ?? null,
        paymentDate: input.payment.paymentDate ?? null,
        creditDate: input.payment.creditDate ?? null,
        estimatedCreditDate: input.payment.estimatedCreditDate ?? null,
      };
      await this.attempts.save(existing);
      return;
    }

    await this.attempts.save(
      this.attempts.create({
        transactionId: input.transactionId,
        gateway: 'asaas',
        asaasPaymentId: paymentId,
        paymentMethod: input.payment.billingType?.trim() || null,
        status,
        statusAt: now,
        amount,
        webhookEvent: input.webhookEvent?.trim() || null,
        metadata: {
          subscription: input.payment.subscription ?? null,
          dueDate: input.payment.dueDate ?? null,
          paymentDate: input.payment.paymentDate ?? null,
          creditDate: input.payment.creditDate ?? null,
          estimatedCreditDate: input.payment.estimatedCreditDate ?? null,
        },
      }),
    );

    await this.transactions.update(
      { id: input.transactionId },
      { status: gatewayStatusToTransactionStatus(input.payment.status) },
    );
  }

  private aggregateTransactionStatus(
    current: TransactionStatus,
    incoming: TransactionStatus,
  ): TransactionStatus {
    const rank: Record<TransactionStatus, number> = {
      [TransactionStatus.PENDING]: 0,
      [TransactionStatus.IN_PROGRESS]: 1,
      [TransactionStatus.FAILED]: 2,
      [TransactionStatus.CANCELLED]: 3,
      [TransactionStatus.COMPLETED]: 4,
    };
    return rank[incoming] >= rank[current] ? incoming : current;
  }
}
