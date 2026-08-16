export const ROLES = ['admin', 'dispatcher', 'crew', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = ['read', 'write', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Grants are role -> module -> actions. '*' as a module key grants across all
 * modules; per-module overrides (e.g. crew limited to specific modules) are
 * layered on top as domain modules arrive in later phases.
 */
const ROLE_GRANTS: Record<Role, Record<string, readonly Action[]>> = {
  admin: { '*': ['read', 'write', 'manage'] },
  dispatcher: { '*': ['read', 'write'] },
  crew: { '*': ['read', 'write'] },
  viewer: { '*': ['read'] },
};

export function can(role: Role, module: string, action: Action): boolean {
  const grants = ROLE_GRANTS[role];
  if (!grants) return false;
  const actions = grants[module] ?? grants['*'] ?? [];
  return actions.includes(action);
}
