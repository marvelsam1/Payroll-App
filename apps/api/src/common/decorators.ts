import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../generated/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Authenticated session derived from the verified JWT — never from the client body. */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  /** null only for PLATFORM_ADMIN (global scope) */
  companyId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

export class TenantRequiredError extends Error {
  constructor() {
    super('A company scope is required for this operation');
  }
}

/** Resolve the tenant for a session; platform admins must pass ?companyId= explicitly. */
export function requireTenant(
  session: SessionUser,
  explicitCompanyId?: string,
): string {
  if (session.companyId) {
    // Tenant roles can never leave their own company, even if they pass one.
    if (explicitCompanyId && explicitCompanyId !== session.companyId) {
      throw new TenantRequiredError();
    }
    return session.companyId;
  }
  if (session.role === Role.PLATFORM_ADMIN && explicitCompanyId) {
    return explicitCompanyId;
  }
  throw new TenantRequiredError();
}
