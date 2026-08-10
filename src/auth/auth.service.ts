import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    this.users.assertAdminAccess(user);

    const valid = await this.users.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const payload = { sub: user.id, email: user.email, roles: user.roles ?? [UserRole.ADMIN] };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: this.users.toSafeUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    this.users.assertAdminAccess(user);
    return this.users.toSafeUser(user);
  }
}
