import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('acaf_partner_terms_acceptances')
@Index(['partnerUserId', 'networkId', 'documentId'], { unique: true })
@Index(['partnerUserId', 'networkId', 'slug'])
export class PartnerTermsAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'partner_user_id', type: 'uuid' })
  partnerUserId: string;

  @Column({ name: 'network_id', type: 'varchar', length: 128 })
  networkId: string;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ type: 'int' })
  version: number;

  @CreateDateColumn({ name: 'accepted_at', type: 'datetime' })
  acceptedAt: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ name: 'signed_name', type: 'varchar', length: 256, nullable: true })
  signedName: string | null;

  /** CPF ou documento do signatário (apenas dígitos). */
  @Column({ name: 'signed_document', type: 'varchar', length: 32, nullable: true })
  signedDocument: string | null;

  @Column({ name: 'signature_image_base64', type: 'text', nullable: true })
  signatureImageBase64: string | null;

  @Column({ name: 'rendered_html_snapshot', type: 'mediumtext', nullable: true })
  renderedHtmlSnapshot: string | null;
}
