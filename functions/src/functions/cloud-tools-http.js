/**
 * cloud-tools-http.js — the one Cloud Tools route that is anonymous AND
 * spends money: POST public/cloud-tools/explain (#613 Phase 3). Semantics,
 * and the four bounds that make an anonymous AI call acceptable, in
 * lib/cloud-tools/explain.js.
 *
 * Identity-checked and rate-limited the way `public/submissions` and the
 * newsletter routes are: the same Cloudflare-verified hashed identity, the
 * same compare-and-increment counter store. The cache-hit path needs
 * neither, which is why the store carries readDoc for it and the other four
 * for the counters and the write.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { createClientIdentity } from '../lib/auth/client-identity.js';
import {
  createDoc,
  incrementIf,
  readDoc,
  replaceDocIfMatch,
  upsertDoc,
} from '../lib/cosmos-client.js';
import * as ai from '../lib/ai/router.js';
import { createExplainHandlers } from '../lib/cloud-tools/explain.js';

let handlers = null;
const explain = () => {
  handlers ??= createExplainHandlers({
    identity: createClientIdentity(),
    store: { readDoc, upsertDoc, incrementIf, createDoc, replaceDocIfMatch },
    ai,
  });
  return handlers;
};

httpRoute('publicCloudToolsExplain', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'public/cloud-tools/explain',
  handler: (request, context) => explain().explain(request, context),
});
