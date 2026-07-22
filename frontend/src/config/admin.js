/**
 * Admin Portal Configuration
 * Compatibility wrapper around claims-based admin configuration.
 */
import {
  ADMIN_ROLES,
  ADMIN_ROUTES,
  PERMISSIONS,
  hasPermission,
  hasRole,
  isAuthorizedAdmin,
  isSuperAdmin,
  getAdminDisplayInfo,
  getAvailableRoles,
  getCachedAdminStatus,
  setCachedAdminStatus,
} from '@/config/admin-v2';

export {
  ADMIN_ROLES,
  ADMIN_ROUTES,
  PERMISSIONS,
  hasPermission,
  hasRole,
  isAuthorizedAdmin,
  isSuperAdmin,
  getAdminDisplayInfo,
  getAvailableRoles,
  getCachedAdminStatus,
  setCachedAdminStatus,
};

// Kept for backward compatibility. Frontend no longer uses static allowlists.
export const OWNER_ADMIN_EMAIL = '';
export const OWNER_ADMIN_UID = '';
export const ADMIN_EMAILS = [];
export const ADMIN_UIDS = [];

// Content Status Workflow
export const CONTENT_STATUSES = {
  INGESTED: 'ingested',
  INSPECTED: 'inspected',
  IN_REVIEW: 'in_review',
  EDITING: 'editing',
  PUBLISHED_BLOG: 'published_blog',
  REJECTED: 'rejected',
};

// Cloud provider options shared across admin pages
export const PROVIDER_OPTIONS = [
  { value: 'Azure', label: 'Azure' },
  { value: 'Aws', label: 'AWS' },
  { value: 'Gcp', label: 'GCP' },
  { value: 'Github', label: 'GitHub' },
  { value: 'Terraform', label: 'Terraform' },
  { value: 'Finops', label: 'FinOps' },
];

// Same list with an auto-detect option for submission forms
export const PROVIDER_OPTIONS_WITH_AUTO = [
  { value: '', label: 'Auto-detect (AI)' },
  ...PROVIDER_OPTIONS,
];

// Landing zone options for blog submission — derived from PROVIDER_OPTIONS
// so adding a new provider here automatically updates the dropdown
export const BLOG_LANDING_ZONE_OPTIONS = [
  { value: '', label: 'Match Cloud Provider' },
  ...PROVIDER_OPTIONS.map((opt) => ({
    value: opt.value,
    label: `${opt.label} Blog Landing`,
  })),
];

/**
 * Check if a user can perform a specific action
 * @param {Object} user - Firebase user object
 * @param {string} action - Action to check permission for
 * @returns {boolean} True if user has permission
 *
 * @todo Implement role-based access control (RBAC)
 * Currently defaults to isAuthorizedAdmin check
 */
export function canPerformAction(user, _action) {
  return isAuthorizedAdmin(user);
}
