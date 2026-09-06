# Admin Portal API Patterns

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


This document establishes the current standard for admin mutations: write through backend handlers,
read from Firestore or backend snapshots where appropriate.

## Overview

The admin portal uses two primary patterns for data operations:

1. **Backend handlers** (`postJSON` from `src/lib/api.js`) - Required for admin mutations,
   validation, workflow enforcement, and audit logging
2. **Read paths** (Firestore SDK or backend snapshot handlers) - Used for UI data hydration and
   reactive reads

---

## Decision Matrix

| Operation Type               | Pattern                      | Rationale                                       |
| ---------------------------- | ---------------------------- | ----------------------------------------------- |
| Status transitions           | Backend handlers             | Validation, audit logging, workflow enforcement |
| Publishing operations        | Backend handlers             | Complex workflows, validation                   |
| Rejection/approval workflows | Backend handlers             | Audit logging, notifications                    |
| Draft save                   | Backend handlers             | Validation, audit logging, conflict handling    |
| Calendar scheduling          | Backend handlers             | Trusted writes, workflow integrity              |
| Prompt configuration         | Backend handlers             | Validation, allowlists, audit logging           |
| Read operations              | Firestore hooks or snapshots | Real-time reads or exact server summaries       |

---

## Required Pattern For Mutations

### Use Cases

✅ **Use backend handlers for:**

- Content status transitions (ingested → inspected → published)
- Publishing operations (multi-step workflows)
- Rejection/approval workflows (requires audit logging)
- Bulk operations (transactions needed)
- Any operation requiring validation, allowlists, or normalization
- Operations that trigger side effects (notifications, webhooks)
- Audit events that must be authoritative
- Metadata/content edits that must be validated (`updateContentItem`)

### Guardrails

- `updateContentItem` is for **metadata/content fields only**.
- It must **not** be used to modify workflow fields like `contentStatus`, `Live`, or publish/audit
  timestamps.
- Use `transitionContentStatus`, `publishContentToBlogs`, `unpublishContentToInspected`, etc. for
  state changes.

### Example

```javascript
import { postJSON } from '@/lib/api';

// PATTERN: backend handler for status transition
// See docs/admin-api-patterns.md
async function approveContent(contentId) {
  try {
    const result = await postJSON('transitionContentStatus', {
      contentId,
      newStatus: 'published_blog',
      markLive: true,
      reviewNotes: 'Approved from queue',
    });

    if (result.success) {
      console.log('Content published successfully');
    }
  } catch (err) {
    console.error('Failed to approve content:', err);
  }
}
```

### Benefits

- ✅ Server-side validation prevents invalid state
- ✅ Automatic audit logging
- ✅ Consistent error handling
- ✅ Can trigger webhooks/notifications
- ✅ Admin email verification on backend

---

## Read Patterns

### Use Cases

✅ **Use Firestore hooks or backend snapshots for:**

- Real-time item reads
- Read-only dashboards
- Lists that need exact backend totals
- UI state hydration after a backend mutation

### Guidance

- Prefer backend snapshot endpoints when counts or aggregates must be exact.
- Prefer Firestore reads when the UI benefits from live updates on already-authorized data.
- Do not introduce new direct client writes for admin-owned collections.

---

## Security Considerations

### Cloud Functions

- ✅ MUST validate admin email before mutations
- ✅ MUST create audit logs for state-changing operations
- ✅ MUST sanitize user input
- ✅ MUST use Firebase Admin SDK for privileged operations

### Firestore Reads

- ✅ MUST respect Firestore security rules
- ✅ SHOULD surface degraded read states explicitly
- ⚠️ SHOULD NOT be used as a privileged write path for admin operations

---

## Real-World Examples

### ✅ GOOD: Editor Save (Backend Handler)

**Why:** Keeps validation, audit, and workflow checks server-side

```javascript
import { postJSON } from '@/lib/api';

async function saveDraft(contentId, payload) {
  return postJSON('saveEditorDraft', {
    contentId,
    ...payload,
  });
}
```

### ✅ GOOD: Publishing (Cloud Function)

**Why:** Complex workflow, requires validation, triggers side effects

```javascript
// src/pages/admin/PublishedPage.jsx
// PATTERN: Cloud Function for publishing operations
// See docs/admin-api-patterns.md
async function handlePublish(itemId) {
  const result = await postJSON('transitionContentStatus', {
    contentId: itemId,
    newStatus: 'published_blog',
    markLive: true,
  });

  if (result.success) {
    // Backend handles audit logging automatically
    refetch();
  }
}
```

### ❌ BAD: Admin Mutation Via Direct Firestore

**Why:** Bypasses validation, audit authority, and workflow enforcement

```javascript
// DON'T DO THIS
await updateDoc(doc(db, 'content', contentId), {
  blogDraft: draftContent,
  scheduledPublishDate: newDate,
});
// Missing: validation, audit authority, workflow checks
```

---

## Migration Checklist

When adding new admin features:

- [ ] **Choose Pattern**: Use a backend handler for any admin mutation
- [ ] **Security Rules**: Verify client writes are not required for the feature
- [ ] **Audit Logging**: Ensure the backend handler owns the audit event
- [ ] **Error Handling**: Implement user-friendly error messages
- [ ] **Documentation**: Add inline comment referencing this doc
- [ ] **Testing**: Verify operation works and audit log created
- [ ] **Environment Variables**: Document any new config in `.env.example`

---

## Active Patterns (Keep Using)

- ✅ `src/lib/api.js` - Working Cloud Function wrapper
- ✅ `src/hooks/useFirestore.js` - Active real-time hooks
- ✅ `src/lib/firebaseConfig.js` - Firebase initialization
- ✅ `src/config/admin.js` - Centralized admin configuration

---

## Deprecated Patterns (Removed)

- ❌ `src/lib/functionsBase.js` - Removed (unused, 81 lines)
- ❌ `src/lib/firebase/firestore.ts` - Removed (unused, 515 lines)

---

## Questions?

If you're unsure which pattern to use:

1. **Is it an admin write?** → Use a backend handler
2. **Is it a read with exact totals or aggregates?** → Use a backend snapshot handler
3. **Is it a real-time read of authorized data?** → Use Firestore reads
4. **Is it a client-side audit write?** → Do not add it

When in doubt, prefer backend handlers for safer defaults.
