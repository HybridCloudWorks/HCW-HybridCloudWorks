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
import { CANONICAL_PROVIDERS } from '@/lib/providers';

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

// How the admin pages name each provider on a button or in a dropdown.
// Keyed by CANONICAL_PROVIDERS; admin.test.js fails if one is missing.
export const PROVIDER_LABELS = Object.freeze({
  azure: 'Azure',
  aws: 'AWS',
  gcp: 'GCP',
  github: 'GitHub',
  terraform: 'Terraform',
  finops: 'FinOps',
  vmware: 'VMware',
  ansible: 'Ansible',
  docker: 'Docker',
});

/**
 * The value the CMS stores in `Cloud Provider` for a route key: the key with
 * its first letter capitalised ('Aws', 'Gcp', 'Vmware'). The server's
 * normalizeProviderName (functions/src/lib/cms/content-update-validation.js)
 * derives the same value from its own registry, and docker-cms.test.js holds
 * the two together.
 */
export const storedProviderValue = (provider) =>
  provider.charAt(0).toUpperCase() + provider.slice(1);

// Cloud provider options shared across admin pages: every provider the site
// routes, derived from CANONICAL_PROVIDERS (lib/providers.js, the one
// registry, held to VALID_PROVIDERS) rather than kept as another copy.
//
// Read by the review board's provider picker (BlogReviewBoard) and the
// Publish-Ready Builder's provider and landing-zone dropdowns (StageOneCard).
// The editor filter and the public submission forms keep their own local
// lists on purpose: each offers only the providers that form can file under.
//
// Hand-kept until 2026-10-03, when it stopped at FinOps: a Docker, VMware or
// Ansible article could not be sent to the publish queue, although each
// provider has had a blog route.
export const PROVIDER_OPTIONS = CANONICAL_PROVIDERS.map((provider) => ({
  value: storedProviderValue(provider),
  label: PROVIDER_LABELS[provider] ?? storedProviderValue(provider),
}));

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
