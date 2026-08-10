import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('acaf_unit_partner_access')
@Index(['unitId', 'userId'], { unique: true })
export class UnitPartnerAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'unit_id', length: 64 })
  unitId: string;

  /** Legado — preenchido apenas durante migração. */
  @Column({ name: 'platform_user_id', type: 'uuid', nullable: true })
  platformUserId: string | null;

  /** Legado — preenchido apenas durante migração. */
  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
