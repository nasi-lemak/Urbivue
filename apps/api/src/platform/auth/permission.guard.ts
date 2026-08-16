import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from '@urbivue/shared';
import { PERMISSION_KEY, RequiredPermission } from './decorators';
import type { AuthUser } from './auth.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // authenticated-only endpoint

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return true; // public endpoint with no user context
    if (!can(user.role, required.module, required.action)) {
      throw new ForbiddenException(
        `Role '${user.role}' may not ${required.action} in module '${required.module}'`,
      );
    }
    return true;
  }
}
