import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuthOtpPurpose {
  LOGIN = 'login',
  PASSWORD_RESET = 'password_reset',
}

@Entity('acaf_auth_otps')
export class AuthOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'mobile_phone', type: 'char', length: 11 })
  mobilePhone: string;

  @Column({ type: 'varchar', length: 32 })
  purpose: AuthOtpPurpose;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'consumed_at', type: 'datetime', nullable: true })
  consumedAt: Date | null;
}
