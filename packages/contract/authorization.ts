/**
 * Who may do what. The matrix is data, and it is shared: the server decides with it, and a client uses it only to
 * predict what it will be allowed, never to grant itself anything. The server checks again on every call.
 */
import { z } from 'zod';
import { lenientEnum } from './primitives';

export const ROLES = ['viewer', 'member', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = lenientEnum(ROLES, 'viewer');

/**
 * The permissions of §10.1 of the design. Every check names a permission, never a role, so widening a role is one
 * edit here and nothing else.
 */
export const PERMISSIONS = {
  /** Read pages, problems, errors, services, metrics and search logs. */
  read: ['viewer', 'member', 'admin'],
  /** Acknowledge and resolve problems and alerts. */
  acknowledge: ['member', 'admin'],
  /** Open, update and close incidents, and write postmortems. */
  'incidents.write': ['member', 'admin'],
  /** Create and edit synthetics, alert rules, SLOs, service mappings and log sources. */
  configure: ['member', 'admin'],
  /** Run an investigation, ask the assistant, export a report. */
  investigate: ['member', 'admin'],
  /** Connections, integrations, credentials and test-connection. */
  'connections.manage': ['admin'],
  /** Users, roles, the API tokens of others, settings, retention and demo mode. */
  administer: ['admin'],
  /** The audit log and system status. */
  'audit.read': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Every permission a role holds, in declaration order. This is what `allowedActions` is computed from. */
export function permissionsOf(role: Role): Permission[] {
  return PERMISSION_NAMES.filter((permission) => can(role, permission));
}

export const permissionSchema = z.enum(PERMISSION_NAMES as [Permission, ...Permission[]]);
