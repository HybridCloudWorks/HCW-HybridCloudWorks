/**
 * addons-public-http.js — the anonymous AddOn status route. Registration only.
 *
 * `GET public/addons/{id}/status` (api-surface.json rest.publicReads; ADR
 * 0035 decision 4), semantics in lib/addons/status.js: no guard,
 * deliberately, because it backs a public page (/tools/<id> opens its pane
 * only when this answers configured and reachable), and it is bounded the
 * way the Coder status read is: one cached document per known id, rewritten
 * at most once a minute, ids closed in lib/addons/registry.js (an unknown id
 * answers 404 before any read), and a six-field projection that never
 * carries the AddOn's address.
 *
 * Listed in PUBLIC_ROUTES in route-inventory.test.js with its reason. The
 * handlers are built on first use rather than at import, like
 * labs-public-http.js: index.js is imported by the route-inventory and
 * api-contract tests under a mocked host.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createAddonStatusHandlers } from '../lib/addons/status.js';

const store = { readDoc, upsertDoc };

let handlers = null;
const addons = () => (handlers ??= createAddonStatusHandlers({ store }));

httpRoute('publicGetAddonStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/addons/{id}/status',
  handler: (request, context) => addons().getAddonStatus(request, context),
});
