import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole, userHasRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';

type MemberJwtPayload = {
  sub: string;
  email: string;
  aud?: string;
};

@Injectable()
export class MemberJwtStrategy extends PassportStrategy(Strategy, 'member-jwt') {
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

  async validate(payload: MemberJwtPayload) {
    if (payload.aud !== 'member') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const user = await this.users.findById(payload.sub);
    if (!user?.active || !userHasRole(user, UserRole.MEMBER)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
    };
  }
}