import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { PermissionsService } from './access-control.service';

type AuthRequest = {
  user?: { userId: string };
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const userId = request.user?.userId;
    if (!userId) throw new ForbiddenException('Acesso negado.');

    const userPermissions = await this.permissions.getUserPermissionKeys(userId);
    const allowed = required.some((key) => userPermissions.includes(key));
    if (!allowed) {
      throw new ForbiddenException('Você não tem permissão para esta ação.');
    }

    return true;
  }
}
