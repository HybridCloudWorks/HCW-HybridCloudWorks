/**
 * labs-public-http.js — the two anonymous labs reads for /education/labs
 * (api-surface.json rest.publicReads; #664 and #680). Registration only;
 * semantics live in lib/labs/estate.js and lib/labs/coder-status.js.
 *
 * No guard, deliberately: both routes serve the public page, and both are
 * bounded by a one-document, one-minute cache (lib/labs/minute-cache.js) so
 * anonymous traffic cannot drive the management plane or Coder. Each is
 * listed in PUBLIC_ROUTES in route-inventory.test.js with that reason.
 *
 * The Resource Graph client is built on first use rather than at import:
 * index.js is imported by the route-inventory and api-contract tests under a
 * mocked host, and nothing here may construct a credential for them.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { queryDocs, readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createCoderStatusHandlers } from '../lib/labs/coder-status.js';
import { createEstateHandlers } from '../lib/labs/estate.js';
import { createResourceGraphClient } from '../lib/labs/resource-graph.js';

const store = { queryDocs, readDoc, upsertDoc };

let arm = null;
const coder = () => createCoderStatusHandlers({ store });
const estate = () =>
  createEstateHandlers({
    store,
    arm: (arm ??= createResourceGraphClient()),
    coderStatus: coder(),
  });

httpRoute('publicGetLabsEstate', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/labs/estate',
  handler: (request, context) => estate().getEstate(request, context),
});

httpRoute('publicGetLabsCoderStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/labs/coder-status',
  handler: (request, context) => coder().getCoderStatus(request, context),
});
