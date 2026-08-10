import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { UsersService } from '../users/users.service';

type PartnerSessionUser = {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  active: boolean;
  roles: string[];
  roleLabels: string[];
};

@Injectable()
export class PartnerAuthService {
  constructor(
    private readonly users: UsersService,
    private readonly partnerAccess: PartnerAccessService,
    private readonly jwt: JwtService,
  ) {}

  private async signSession(user: PartnerSessionUser, unitIds: string[]) {
    const payload = {
      sub: user.id,
      email: user.email,
      aud: 'partner',
    };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user, unitIds };
  }

  async login(login: string, password: string) {
    const trimmed = login.trim();
    if (!trimmed || !password) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const user = await this.users.findByLogin(trimmed);
    if (!user?.active) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const valid = await this.users.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Usuário ou senha inválidos.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    if (!unitIds.length) {
      throw new UnauthorizedException('Usuário sem acesso a nenhuma unidade.');
    }

    const safe = this.users.toSafeUser(user);
    return this.signSession(
      {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    );
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.active) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const unitIds = await this.partnerAccess.listUnitIdsForUser(user.id);
    const safe = this.users.toSafeUser(user);
    return {
      user: {
        id: safe.id,
        name: safe.name,
        email: safe.email,
        cpf: safe.cpf,
        active: safe.active,
        roles: safe.roles,
        roleLabels: safe.roleLabels,
      },
      unitIds,
    };
  }
}
