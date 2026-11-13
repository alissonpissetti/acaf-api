import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { TRANSACTION_GATEWAY_ASAAS } from './transaction.types';

@Entity('acaf_transaction_gateway_attempts')
export class TransactionGatewayAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => Transaction, (row) => row.gatewayAttempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Column({ type: 'varchar', length: 24, default: TRANSACTION_GATEWAY_ASAAS })
  gateway: string;

  @Column({ name: 'asaas_payment_id', type: 'varchar', length: 40, nullable: true, unique: true })
  asaasPaymentId: string | null;

  @Column({ name: 'payment_method', type: 'varchar', length: 32, nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'varchar', length: 40 })
  status: string;

  @Column({ name: 'status_at', type: 'datetime' })
  statusAt: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  amount: string | null;

  @Column({ name: 'webhook_event', type: 'varchar', length: 48, nullable: true })
  webhookEvent: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
