import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PixKeyType } from './pix.utils';
import { Supplier } from './supplier.entity';

@Entity('acaf_supplier_pix_keys')
export class SupplierPixKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne(() => Supplier, (supplier) => supplier.pixKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ type: 'enum', enum: ['cpf', 'cnpj', 'email', 'phone', 'random'] })
  type: PixKeyType;

  @Column({ name: 'key_value', type: 'varchar', length: 120 })
  keyValue: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  label: string | null;

  @Column({ name: 'is_primary', default: false })
  isPrimary: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'confirmed_by_payable_id', type: 'uuid', nullable: true })
  confirmedByPayableId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
