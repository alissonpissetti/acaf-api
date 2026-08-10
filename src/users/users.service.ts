import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Brackets, Repository } from 'typeorm';
import { User, UserRole, userHasRole } from './user.entity';
import {
  formatCpf,
  formatMobilePhone,
  isValidCpf,
  isValidMobilePhone,
  normalizeCpf,
  normalizeMobilePhone,
} from './person.utils';

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  mobilePhone: string | null;
  roles: UserRole[];
  roleLabels: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mergeRoles(existing: UserRole[] | undefined, next: UserRole[]): UserRole[] {
  return [...new Set([...(existing ?? []), ...next])];
}

function normalizeRoles(raw: unknown): UserRole[] {
  if (Array.isArray(raw)) return raw.filter(Boolean) as UserRole[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed.filter(Boolean) as UserRole[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function roleLabelsFor(roles: UserRole[]): string[] {
  const labels: string[] = [];
  if (roles.includes(UserRole.ADMIN)) labels.push('Console admin');
  if (roles.includes(UserRole.MEMBER)) labels.push('Cliente');
  if (roles.includes(UserRole.CORPORATE)) labels.push('Gestor corporativo');
  if (!labels.length) labels.push('Usuário');
  return labels;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const count = await this.users.count();
    if (count > 0) return;

    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;

    await this.create({
      name: 'Administrador',
      email,
      password,
      roles: [UserRole.ADMIN],
    });
  }

  toSafeUser(user: User): SafeUser {
    const roles = normalizeRoles(user.roles);
    if (!roles.length && user.passwordHash) {
      roles.push(UserRole.ADMIN);
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpf: user.cpf ? formatCpf(user.cpf) : null,
      mobilePhone: user.mobilePhone ? formatMobilePhone(user.mobilePhone) : null,
      roles,
      roleLabels: roleLabelsFor(roles),
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async findAll(): Promise<SafeUser[]> {
    const rows = await this.users.find({ order: { name: 'ASC' } });
    return rows.map((user) => this.toSafeUser(user));
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({
      where: { email: email.toLowerCase().trim() },
      select: [
        'id',
        'name',
        'email',
        'cpf',
        'mobilePhone',
        'passwordHash',
        'roles',
        'active',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByCpf(cpf: string): Promise<User | null> {
    const digits = normalizeCpf(cpf);
    if (digits.length !== 11) return null;
    return this.users.findOne({
      where: { cpf: digits },
      select: [
        'id',
        'name',
        'email',
        'cpf',
        'mobilePhone',
        'passwordHash',
        'roles',
        'active',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async findByLogin(login: string): Promise<User | null> {
    const trimmed = login.trim().toLowerCase();
    const cpf = normalizeCpf(login);
    if (cpf.length === 11) {
      return this.findByCpf(cpf);
    }
    return this.findByEmail(trimmed);
  }

  private resolvePersonFields(input: { cpf?: string; mobilePhone?: string }, required = false) {
    const cpfRaw = input.cpf !== undefined ? normalizeCpf(input.cpf) : undefined;
    const phoneRaw =
      input.mobilePhone !== undefined ? normalizeMobilePhone(input.mobilePhone) : undefined;

    if (required || cpfRaw !== undefined) {
      if (!cpfRaw) throw new BadRequestException('Informe o CPF.');
      if (!isValidCpf(cpfRaw)) throw new BadRequestException('CPF inválido.');
    }

    if (required || phoneRaw !== undefined) {
      if (!phoneRaw) throw new BadRequestException('Informe o celular.');
      if (!isValidMobilePhone(phoneRaw)) {
        throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
      }
    }

    return { cpf: cpfRaw, mobilePhone: phoneRaw };
  }

  private async assertUniquePersonFields(
    cpf: string | undefined,
    mobilePhone: string | undefined,
    excludeId?: string,
  ) {
    if (cpf) {
      const existingCpf = await this.users.findOne({ where: { cpf } });
      if (existingCpf && existingCpf.id !== excludeId) {
        throw new ConflictException('CPF já cadastrado.');
      }
    }
    if (mobilePhone) {
      const existingPhone = await this.users.findOne({ where: { mobilePhone } });
      if (existingPhone && existingPhone.id !== excludeId) {
        throw new ConflictException('Celular já cadastrado.');
      }
    }
  }

  async search(query: string, limit = 12): Promise<SafeUser[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('Informe ao menos 2 caracteres para buscar.');
    }

    const cpfDigits = normalizeCpf(trimmed);
    const phoneDigits = normalizeMobilePhone(trimmed);
    const q = `%${trimmed.toLowerCase()}%`;
    const qb = this.users
      .createQueryBuilder('user')
      .where('user.active = :active', { active: true })
      .orderBy('user.name', 'ASC')
      .take(limit);

    qb.andWhere(
      new Brackets((where) => {
        where.where('LOWER(user.name) LIKE :nameQ', { nameQ: q });
        where.orWhere('LOWER(user.email) LIKE :emailQ', { emailQ: q });
        if (cpfDigits.length >= 3) {
          where.orWhere('user.cpf LIKE :cpfQ', { cpfQ: `${cpfDigits}%` });
        }
        if (phoneDigits.length >= 4) {
          where.orWhere('user.mobilePhone LIKE :phoneQ', { phoneQ: `${phoneDigits}%` });
        }
      }),
    );

    const rows = await qb.getMany();
    return rows.map((user) => this.toSafeUser(user));
  }

  async create(input: {
    name: string;
    email: string;
    password?: string;
    cpf?: string;
    mobilePhone?: string;
    roles?: UserRole[];
  }): Promise<SafeUser> {
    const email = input.email.toLowerCase().trim();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    let cpf: string | null = null;
    let mobilePhone: string | null = null;
    if (input.cpf !== undefined || input.mobilePhone !== undefined) {
      const person = this.resolvePersonFields(
        { cpf: input.cpf ?? '', mobilePhone: input.mobilePhone ?? '' },
        Boolean(input.roles?.includes(UserRole.ADMIN)),
      );
      cpf = person.cpf ?? null;
      mobilePhone = person.mobilePhone ?? null;
      await this.assertUniquePersonFields(cpf ?? undefined, mobilePhone ?? undefined);
    }

    let passwordHash: string | null = null;
    if (input.password) {
      if (input.password.length < 6) {
        throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
      }
      passwordHash = await bcrypt.hash(input.password, 10);
    } else if (input.roles?.includes(UserRole.ADMIN)) {
      throw new BadRequestException('Informe uma senha para usuários do console admin.');
    }

    const user = this.users.create({
      name: input.name.trim(),
      email,
      cpf,
      mobilePhone,
      passwordHash,
      roles: input.roles?.length ? input.roles : [UserRole.ADMIN],
      active: true,
    });

    const saved = await this.users.save(user);
    return this.toSafeUser(saved);
  }

  async ensureMemberUser(input: {
    name: string;
    email: string;
    cpf?: string;
  }): Promise<string> {
    const email = input.email.toLowerCase().trim();
    if (!email) {
      throw new BadRequestException('E-mail do cliente é obrigatório para sincronizar usuários.');
    }

    let user = await this.findByEmail(email);
    const cpf = input.cpf ? normalizeCpf(input.cpf) : undefined;

    if (!user && cpf) {
      user = await this.findByCpf(cpf);
    }

    if (!user) {
      const saved = await this.users.save(
        this.users.create({
          name: input.name.trim(),
          email,
          cpf: cpf && isValidCpf(cpf) ? cpf : null,
          mobilePhone: null,
          passwordHash: null,
          roles: [UserRole.MEMBER],
          active: true,
        }),
      );
      return saved.id;
    }

    user.name = input.name.trim();
    if (cpf && isValidCpf(cpf) && !user.cpf) user.cpf = cpf;
    user.roles = mergeRoles(normalizeRoles(user.roles), [UserRole.MEMBER]);
    await this.users.save(user);
    return user.id;
  }

  async createWithPassword(input: {
    name: string;
    email: string;
    cpf: string;
    password: string;
    roles?: UserRole[];
  }): Promise<SafeUser> {
    const cpf = normalizeCpf(input.cpf);
    if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido.');
    return this.create({
      ...input,
      cpf,
      roles: input.roles ?? [],
    });
  }

  async update(
    id: string,
    patch: {
      name?: string;
      cpf?: string;
      mobilePhone?: string;
      active?: boolean;
      password?: string;
      roles?: UserRole[];
    },
  ): Promise<SafeUser> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (patch.name !== undefined) user.name = patch.name.trim();
    if (patch.active !== undefined) user.active = patch.active;
    if (patch.roles !== undefined) user.roles = patch.roles;
    if (patch.password) {
      user.passwordHash = await bcrypt.hash(patch.password, 10);
    }

    if (patch.cpf !== undefined) {
      const cpf = normalizeCpf(patch.cpf);
      if (!cpf) throw new BadRequestException('Informe o CPF.');
      if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido.');
      user.cpf = cpf;
    }

    if (patch.mobilePhone !== undefined) {
      const mobilePhone = normalizeMobilePhone(patch.mobilePhone);
      if (!mobilePhone) throw new BadRequestException('Informe o celular.');
      if (!isValidMobilePhone(mobilePhone)) {
        throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
      }
      user.mobilePhone = mobilePhone;
    }

    await this.assertUniquePersonFields(user.cpf ?? undefined, user.mobilePhone ?? undefined, id);

    const saved = await this.users.save(user);
    return this.toSafeUser(saved);
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  assertAdminAccess(user: User) {
    if (!user.active || !userHasRole(user, UserRole.ADMIN)) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
  }

  async remove(id: string, currentUserId?: string): Promise<{ ok: true }> {
    if (currentUserId && currentUserId === id) {
      throw new BadRequestException('Você não pode remover seu próprio usuário.');
    }

    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    await this.users.remove(user);
    return { ok: true };
  }
}
