import type { OrgRole } from '../types';

const ADMIN_BLOCKED_SEGMENTS = new Set([
  'event',
  'ticket-types',
  'orders',
  'tickets',
  'submissions',
]);

/** Menus réservés au owner (super admin org). */
export function canAccessAdminRoute(role: OrgRole | null | undefined, segment: string): boolean {
  if (!role || role === 'owner') return true;
  if (role === 'scanner') return false;
  if (role === 'admin') {
    return !ADMIN_BLOCKED_SEGMENTS.has(segment);
  }
  return false;
}

/** Exports CSV/PDF : owner uniquement. */
export function canExportAny(role: OrgRole | null | undefined): boolean {
  return role === 'owner';
}