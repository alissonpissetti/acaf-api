import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  MEMBER = 'member',
  CORPORATE = 'corporate',
}

@Entity('acaf_users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ type: 'char', length: 11, unique: true, nullable: true })
  cpf: string | null;

  @Column({ name: 'mobile_phone', type: 'char', length: 11, unique: true, nullable: true })
  mobilePhone: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'json', nullable: true })
  roles: UserRole[] | null;

  @Column({ name: 'user_group_id', type: 'uuid', nullable: true })
  userGroupId: string | null;

  @Column({ name: 'job_position_id', type: 'uuid', nullable: true })
  jobPositionId: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'avatar_color', type: 'varchar', length: 32, nullable: true })
  avatarColor: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export function userHasRole(user: Pick<User, 'roles'>, role: UserRole): boolean {
  return Array.isArray(user.roles) && user.roles.includes(role);
}

export function roleLabels(roles: UserRole[] | undefined): string[] {
  if (!roles?.length) return ['Usuário'];
  const labels: string[] = [];
  if (roles.includes(UserRole.ADMIN)) labels.push('Console admin');
  if (roles.includes(UserRole.MEMBER)) labels.push('Cliente');
  if (roles.includes(UserRole.CORPORATE)) labels.push('Gestor corporativo');
  if (!labels.length) return ['Usuário'];
  return labels;
}
