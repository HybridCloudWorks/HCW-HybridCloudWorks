/**
 * containers.js — where the AI configuration lives in Cosmos: the provider
 * cards' container and the settings container with its document ids.
 *
 * Split from ai-config.js in ADR 0034 slice 3 (#858) so the catalogue's read
 * path (model-catalog-doc.js) can name the container without importing the
 * loader, which imports it. ai-config.js re-exports these; every caller
 * keeps importing them from there.
 */
export const PROVIDERS_CONTAINER = 'ai_providers';
export const SETTINGS_CONTAINER = 'admin_settings';
export const FEATURES_DOC_ID = 'ai-features';
