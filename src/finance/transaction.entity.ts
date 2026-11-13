import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { AccountReceivable } from './account-receivable.entity';
import { TransactionGatewayAttempt } from './transaction-gateway-attempt.entity';
import { TransactionStatus, type TransactionKind } from './transaction.types';

@Entity('acaf_transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 40 })
  kind: TransactionKind;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Column({ name: 'amount_total', type: 'decimal', precision: 15, scale: 2 })
  amountTotal: string;

  @Column({ type: 'varchar', length: 8, default: 'BRL' })
  currency: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'partner_unit_id', type: 'uuid', nullable: true })
  partnerUnitId: string | null;

  /** Chave normalizada do titular da assinatura (`holderKey`). */
  @Column({ name: 'connect_holder_key', type: 'varchar', length: 64, nullable: true })
  connectHolderKey: string | null;

  @Column({ name: 'asaas_subscription_id', type: 'varchar', length: 40, nullable: true })
  asaasSubscriptionId: string | null;

  /** Chave idempotente (ex.: `asaas:subscription:{id}` ou `asaas:payment:{id}`). */
  @Column({ name: 'external_ref', type: 'varchar', length: 120, nullable: true, unique: true })
  externalRef: string | null;

  @OneToMany(() => AccountReceivable, (row) => row.transaction)
  receivables: AccountReceivable[];

  @OneToMany(() => TransactionGatewayAttempt, (row) => row.transaction)
  gatewayAttempts: TransactionGatewayAttempt[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
