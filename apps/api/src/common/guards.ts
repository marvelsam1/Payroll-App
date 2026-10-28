import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, SessionUser } from './decorators';
import { hasPermission, Permission } from './permissions';
import { Role } from '../generated/client';

/**
 * Global authentication guard: verifies the bearer JWT and attaches the
 * session used for every tenant-scoping decision downstream.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        role: Role;
        companyId: string | null;
      }>(token);
      const user: SessionUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        companyId: payload.companyId ?? null,
      };
      request.user = user;
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/**
 * Global RBAC guard — permissions from the API matrix are checked server-side
 * on every route. Platform admins bypass; everything else is explicit.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user: SessionUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (user.role === Role.PLATFORM_ADMIN) return true;

    const allowed = required.every((p) => hasPermission(user.role, p));
    if (!allowed) {
      throw new ForbiddenException(
        `Role ${user.role} lacks permission: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
