import { SetMetadata } from '@nestjs/common';
import type { Action } from '@urbivue/shared';

export const IS_PUBLIC_KEY = 'urbivue:public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'urbivue:permission';
export interface RequiredPermission {
  module: string;
  action: Action;
}
export const RequirePermission = (module: string, action: Action) =>
  SetMetadata(PERMISSION_KEY, { module, action } satisfies RequiredPermission);
