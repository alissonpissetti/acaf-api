import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('acaf_partner_onboarding_invites')
@Index(['tokenHash'], { unique: true })
export class PartnerOnboardingInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** SHA-256 hex do token (nunca armazenar o token em claro). */
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'network_id', type: 'varchar', length: 128 })
  networkId: string;

  /** `onboarding` = primeiro acesso da rede; `team` = usuário adicional com unidades já vinculadas. */
  @Column({ name: 'kind', type: 'varchar', length: 16, default: 'onboarding' })
  kind: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'used_by_user_id', type: 'uuid', nullable: true })
  usedByUserId: string | null;

  /** MariaDB não suporta `timestamptz`; use `datetime` como nas demais entities. */
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
