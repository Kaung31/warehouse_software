import { Role } from '@prisma/client'

export const PERMISSIONS = {
  'repair:create':          [Role.ADMIN, Role.MANAGER, Role.CS],
  'repair:view':            [Role.ADMIN, Role.MANAGER, Role.MECHANIC, Role.CS, Role.WAREHOUSE],
  'repair:update':          [Role.ADMIN, Role.MANAGER, Role.MECHANIC],
  'repair:assign_mechanic': [Role.ADMIN, Role.MANAGER],
  'repair:delete':          [Role.ADMIN],
  'repair:view_cost':       [Role.ADMIN, Role.MANAGER],

  'scooter:create': [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'scooter:view':   [Role.ADMIN, Role.MANAGER, Role.MECHANIC, Role.CS, Role.WAREHOUSE],
  'scooter:update': [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'scooter:delete': [Role.ADMIN],

  'parts:view':              [Role.ADMIN, Role.MANAGER, Role.MECHANIC, Role.WAREHOUSE],
  'parts:manage':            [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'parts:consume_in_repair': [Role.ADMIN, Role.MANAGER, Role.MECHANIC],
  'stock:adjust':            [Role.ADMIN, Role.MANAGER],
  'stock:view_movements':    [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],

  'shipping:create': [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'shipping:view':   [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE, Role.CS],

  'customer:create': [Role.ADMIN, Role.MANAGER, Role.CS],
  'customer:view':   [Role.ADMIN, Role.MANAGER, Role.CS, Role.WAREHOUSE],
  'customer:update': [Role.ADMIN, Role.MANAGER, Role.CS],
  'customer:delete': [Role.ADMIN],

  'reports:view': [Role.ADMIN, Role.MANAGER],
  'users:manage': [Role.ADMIN],
  'pricing:view': [Role.ADMIN, Role.MANAGER],

  // New workflow permissions
  'case:intake':          [Role.ADMIN, Role.MANAGER, Role.CS],
  'case:inbound_triage':  [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'case:view':            [Role.ADMIN, Role.MANAGER, Role.MECHANIC, Role.CS, Role.WAREHOUSE],
  'case:cs_update':       [Role.ADMIN, Role.MANAGER, Role.CS],
  'case:start_repair':    [Role.ADMIN, Role.MANAGER, Role.MECHANIC],
  'case:qc_submit':       [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
  'case:dispatch':        [Role.ADMIN, Role.MANAGER, Role.WAREHOUSE],
} satisfies Record<string, Role[]>

export type Permission = keyof typeof PERMISSIONS

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as Role[]).includes(role)
}

export function requireRole(userRole: Role, permission: Permission): void {
  if (!hasPermission(userRole, permission)) {
    throw new Error('FORBIDDEN')
  }
}
