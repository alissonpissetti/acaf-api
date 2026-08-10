import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { UsersService } from '../users/users.service';

type PartnerJwtPayload = {
  sub: string;
  email: string;
  aud?: string;
};

@Injectable()
export class PartnerJwtStrategy extends PassportStrategy(Strategy, 'partner-jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly partnerAccess: PartnerAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: PartnerJwtPayload) {
    if (payload.aud !== 'partner') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const user = await this.users.findById(payload.sub);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);

    return {
      platformUserId: user.id,
      userId: user.id,
      email: user.email,
      unitIds,
    };
  }
}
