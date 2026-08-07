/**
 * admin-uploads-http.js — the authed file-upload route replacing browser
 * firebase/storage uploadBytes. Registration only; semantics and the
 * container/path validation in lib/admin-uploads.js.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { uploadBlob } from '../lib/blob-storage.js';
import { createAdminUploadHandlers } from '../lib/admin-uploads.js';

const handlers = () =>
  createAdminUploadHandlers({
    guard: getDefaultGuard(),
    storage: { uploadBlob },
  });

app.http('cmsUploadFile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/uploads/{container}',
  handler: (request, context) => handlers().uploadFile(request, context),
});
