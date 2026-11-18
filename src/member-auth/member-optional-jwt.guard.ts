import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

/** Aceita Bearer `member` JWT quando presente; não bloqueia requisição sem token. */
@Injectable()
export class MemberOptionalJwtAuthGuard extends AuthGuard('member-jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers.authorization?.trim();
    if (!auth?.startsWith('Bearer ')) {
      return true;
    }
    try {
      const result = await super.canActivate(context);
      return Boolean(result);
    } catch {
      return true;
    }
  }

  handleRequest<TUser = { userId: string; email: string; name: string } | null>(
    err: Error | null,
    user: TUser,
  ): TUser | null {
    if (err || !user) {
      return null;
    }
    return user;
  }
}