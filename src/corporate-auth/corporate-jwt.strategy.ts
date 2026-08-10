import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { UsersService } from '../users/users.service';

type CorporateJwtPayload = {
  sub: string;
  email: string;
  aud?: string;
  companyId?: string;
};

@Injectable()
export class CorporateJwtStrategy extends PassportStrategy(Strategy, 'corporate-jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly access: CorporateAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: CorporateJwtPayload) {
    if (payload.aud !== 'corporate') {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const user = await this.users.findById(payload.sub);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const companyIds = await this.access.listActiveCompanyIdsForUser(user.id);
    const companyId =
      payload.companyId && companyIds.includes(payload.companyId)
        ? payload.companyId
        : companyIds[0];

    if (!companyId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return {
      userId: user.id,
      email: user.email,
      companyIds,
      companyId,
    };
  }
}
