/**
 * newsletter-http.js — public newsletter signup and double opt-in confirmation
 * (#504, ADR 0030). Semantics in lib/newsletter/handlers.js.
 *
 * Both routes are anonymous and both are identity-checked and rate-limited the
 * way `public/submissions` is: without the Cloudflare origin secret they answer
 * 403 rather than count against a spoofable address.
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
import { createNewsletterHandlers } from '../lib/newsletter/handlers.js';

let handlers = null;
const newsletter = () => {
  handlers ??= createNewsletterHandlers({
    identity: createClientIdentity(),
    store: { readDoc, upsertDoc, incrementIf, createDoc, replaceDocIfMatch },
  });
  return handlers;
};

httpRoute('publicNewsletterSubscribe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'public/newsletter/subscribe',
  handler: (request, context) => newsletter().subscribe(request, context),
});

httpRoute('publicNewsletterConfirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'public/newsletter/confirm',
  handler: (request, context) => newsletter().confirm(request, context),
});
