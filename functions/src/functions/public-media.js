/**
 * public-media.js — anonymous media delivery route. Registration only;
 * semantics and the reasoning for the delivery model live in
 * lib/public-media.js.
 *
 * No guard, by design: these are the blob reads the browser used to make
 * directly against Firebase Storage under public rules. The lib enforces the
 * container allowlist and path validation that replace them.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import {
  headBlobForDelivery,
  readBlobForDelivery,
  readBlobRangeForDelivery,
} from '../lib/blob-storage.js';
import { createPublicMediaHandlers } from '../lib/public-media.js';

const handlers = () =>
  createPublicMediaHandlers({
    storage: { readBlobForDelivery, readBlobRangeForDelivery, headBlobForDelivery },
  });

httpRoute('publicGetMedia', {
  // HEAD alongside GET (#349): a player or a directory checks size and range
  // support before it asks for bytes, and the host only routes the methods
  // declared here.
  methods: ['GET', 'HEAD'],
  authLevel: 'anonymous',
  // The wildcard segment is required: blob paths contain slashes
  // ({docId}/images/badge-{ts}.png).
  route: 'public/media/{container}/{*blobPath}',
  handler: (request, context) => handlers().getMedia(request, context),
});
