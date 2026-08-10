import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Brackets, Repository } from 'typeorm';
import { PlatformUser } from './platform-user.entity';

export type SafePlatformUser = {
  id: string;
  name: string;
  email: string;
  cpf: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isValidCpf(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(digits[10]);
}

@Injectable()
export class PlatformUsersService {
  constructor(
    @InjectRepository(PlatformUser)
    private readonly users: Repository<PlatformUser>,
  ) {}

  toSafeUser(user: PlatformUser): SafePlatformUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpf: formatCpf(user.cpf),
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async search(query: string, limit = 12): Promise<SafePlatformUser[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('Informe ao menos 2 caracteres para buscar.');
    }

    const cpfDigits = normalizeCpf(trimmed);
    const qb = this.users
      .createQueryBuilder('user')
      .where('user.active = :active', { active: true })
      .take(limit)
      .orderBy('user.name', 'ASC');

    qb.andWhere(
      new Brackets((where) => {
        where.where('LOWER(user.name) LIKE :name', { name: `%${trimmed.toLowerCase()}%` });
        where.orWhere('LOWER(user.email) LIKE :email', { email: `%${trimmed.toLowerCase()}%` });
        if (cpfDigits.length >= 3) {
          where.orWhere('user.cpf LIKE :cpf', { cpf: `${cpfDigits}%` });
        }
      }),
    );

    const rows = await qb.getMany();
    return rows.map((user) => this.toSafeUser(user));
  }

  async findById(id: string): Promise<PlatformUser | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByLogin(login: string): Promise<PlatformUser | null> {
    const trimmed = login.trim().toLowerCase();
    const cpf = normalizeCpf(login);
    if (cpf.length === 11) {
      return this.users.findOne({
        where: { cpf },
        select: [
          'id',
          'name',
          'email',
          'cpf',
          'passwordHash',
          'active',
          'createdAt',
          'updatedAt',
        ],
      });
    }
    return this.users.findOne({
      where: { email: trimmed },
      select: [
        'id',
        'name',
        'email',
        'cpf',
        'passwordHash',
        'active',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async create(input: {
    name: string;
    email: string;
    cpf: string;
    password: string;
  }): Promise<SafePlatformUser> {
    const name = input.name.trim();
    const email = input.email.toLowerCase().trim();
    const cpf = normalizeCpf(input.cpf);
    if (!name) throw new BadRequestException('Informe o nome.');
    if (!email) throw new BadRequestException('Informe o e-mail.');
    if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido.');
    if (!input.password || input.password.length < 6) {
      throw new BadRequestException('Informe uma senha com ao menos 6 caracteres.');
    }

    const existingEmail = await this.users.findOne({ where: { email } });
    if (existingEmail) throw new ConflictException('E-mail já cadastrado.');

    const existingCpf = await this.users.findOne({ where: { cpf } });
    if (existingCpf) throw new ConflictException('CPF já cadastrado.');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const saved = await this.users.save(
      this.users.create({ name, email, cpf, passwordHash, active: true }),
    );
    return this.toSafeUser(saved);
  }

  async validatePassword(user: PlatformUser, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }
}
