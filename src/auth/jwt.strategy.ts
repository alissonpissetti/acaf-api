import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  sub: string;
  email: string;
  roles?: UserRole[];
  role?: UserRole;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const roles = user.roles?.length
      ? user.roles
      : payload.roles?.length
        ? payload.roles
        : payload.role
          ? [payload.role]
          : [];

    if (!roles.includes(UserRole.ADMIN)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return {
      userId: user.id,
      email: user.email,
      roles,
    };
  }
}
