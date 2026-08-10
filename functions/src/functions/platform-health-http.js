/**
 * platform-health-http.js — the landing page's cloud-status indicators.
 * Registration only; the checks, the cache and the degradation rules live in
 * lib/platform-health.js.
 *
 * No guard, by design: this backs four indicators rendered to every anonymous
 * visitor on the home page. It reads nothing from the database and returns a
 * fixed-shape payload of four enum values.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { createPlatformHealthHandler } from '../lib/platform-health.js';

// Built once at module load so the cache lives across invocations on an
// instance — that cache is what bounds the load this route puts on four
// third-party status APIs.
const getPlatformHealth = createPlatformHealthHandler();

httpRoute('publicGetPlatformHealth', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/platform-health',
  handler: getPlatformHealth,
});
