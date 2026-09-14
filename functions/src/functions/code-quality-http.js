/**
 * code-quality-http.js — the Health Hub's Code and Security summary (#569).
 * Qlty's open issues and project metrics, read server-side with
 * QLTY_API_TOKEN and condensed; semantics in lib/code-quality/qlty-summary.js.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createCodeQualityHandlers } from '../lib/code-quality/qlty-summary.js';

let handlers = null;
const codeQuality = () => {
  handlers ??= createCodeQualityHandlers({ guard: getDefaultGuard() });
  return handlers;
};

httpRoute('codeQualitySummary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/code-quality',
  handler: (request, context) => codeQuality().summary(request, context),
});
