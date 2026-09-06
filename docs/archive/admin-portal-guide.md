# Admin Portal Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


Complete guide to the HybridCloudWorks Content Forge admin portal.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Admin Pages](#admin-pages)
4. [Content Workflows](#content-workflows)
5. [API Patterns](#api-patterns)
6. [Security Best Practices](#security-best-practices)
7. [Adding New Features](#adding-new-features)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The **Content Forge** admin portal (`/admin/*`) is a full-featured content management system (CMS)
for managing blog posts, news articles, architecture content, frameworks, and more.

### Key Features

- 📝 **Content Submission** - Multi-stage URL ingestion and content extraction
- 🔍 **Queue Management** - Review, approve, or reject submitted content
- ✏️ **Rich Text Editor** - Draft, edit, and preview content with live markdown support
- 📅 **Calendar Scheduling** - Visual scheduling of content publication
- 📊 **Dashboard** - Pipeline overview and batch operations
- 🔒 **Authentication** - Google sign-in plus backend-admin authorization enforcement

### Tech Stack

- **Frontend:** React, TailwindCSS, shadcn/ui components
- **Backend:** Cloud Functions (Node.js)
- **Database:** Firestore
- **Auth:** Firebase Authentication (Google provider)
- **Storage:** Firebase Storage (images)

---

## Architecture

### File Structure

```
src/
├── pages/admin/
│   ├── AdminAuthGuard.jsx       # Auth wrapper for all admin pages
│   ├── AdminLayout.jsx          # Shared layout (sidebar, nav)
│   ├── DashboardPage.jsx        # Admin home (pipeline overview)
│   ├── SubmitUrlsPage.jsx       # 4-stage content submission flow
│   ├── QueuePage.jsx            # Content queue management
│   ├── ReviewPage.jsx           # Individual content review
│   ├── EditorPage.jsx           # Rich text editor for drafts
│   ├── CalendarPage.jsx         # Visual scheduling calendar
│   └── PublishedPage.jsx        # Ready-to-publish and published items
├── config/
│   └── admin.js                 # Centralized admin configuration
├── lib/
│   ├── api.js                   # Cloud Function wrapper (postJSON)
│   ├── auditLog.js              # Audit logging helper
│   └── firebaseConfig.js        # Firebase initialization
└── hooks/
    └── useFirestore.js          # Real-time Firestore hooks
```

### Data Flow

```
User submits URL
    ↓
Cloud Function: fetchNewsContent (scrape + AI extraction)
    ↓
Firestore: content collection (status: 'ingested')
    ↓
Admin reviews in Queue
    ↓
Cloud Function: transitionContentStatus (status: 'inspected')
    ↓
Admin edits in Editor (backend draft save)
    ↓
Cloud Function: transitionContentStatus / publishContentToBlogs
    ↓
Content appears on public pages
```

---

## Admin Pages

### Dashboard (`/admin`)

**Purpose:** Pipeline overview and batch operations

**Features:**

- Pipeline status cards (Ingested, Inspected, In Review, Published)
- Batch operations (RSS Fetch, Batch Inspect)
- Recent activity feed
- Quick links to Queue and Submit pages

**Key Files:**

- `src/pages/admin/DashboardPage.jsx`

---

### Submit URLs (`/admin/submit`)

**Purpose:** Multi-stage content submission workflow

**Stages:**

1. **URL Input** - Paste URLs (one per line)
2. **Fetching** - Cloud Function scrapes content
3. **Image Generation** - Optional AI image generation
4. **Save** - Write to Firestore

**Key Files:**

- `src/pages/admin/SubmitUrlsPage.jsx`
- Cloud Function: `fetchNewsContent`

**Supported Content Types:**

- Blog posts
- News articles
- Frameworks
- Architecture patterns
- Coder Corner tutorials

---

### Queue (`/admin/queue`)

**Purpose:** Review and manage submitted content

**Features:**

- Filter by status (ingested, inspected, in_review, rejected)
- Filter by content type (blog, news, framework, architecture)
- Approve content → sends to Published page
- Reject content → moves to rejected status
- Restore rejected content
- Bulk selection and operations

**Key Files:**

- `src/pages/admin/QueuePage.jsx`

**Actions:**

- **Approve** → Cloud Function: `transitionContentStatus` (inspected)
- **Reject** → Cloud Function: `transitionContentStatus` (rejected)
- **Restore** → Cloud Function: `transitionContentStatus` (ingested)

---

### Review (`/admin/queue/:id`)

**Purpose:** Detailed review of individual content item

**Features:**

- Edit metadata (title, description, tags)
- Edit architecture categories and frameworks
- Preview rendered content
- Navigate to Editor for full editing

**Key Files:**

- `src/pages/admin/ReviewPage.jsx`

**Pattern:** Backend handlers for metadata updates and review-state changes (See
[API Patterns](#api-patterns))

---

### Editor (`/admin/editor/:id`)

**Purpose:** Rich text editing for blog drafts

**Features:**

- Monaco Editor for markdown editing
- Live preview (split-screen)
- Auto-save (debounced 2 seconds)
- Syntax highlighting
- Character/word count

**Key Files:**

- `src/pages/admin/EditorPage.jsx`

**Pattern:** Backend handler for draft save and validation

```javascript
// PATTERN: backend handler for editor save
// See docs/admin-api-patterns.md
await postJSON('saveEditorDraft', {
  contentId: blogId,
  draft,
});
```

---

### Published (`/admin/published`)

**Purpose:** Manage ready-to-publish and published content

**Sections:**

1. **Ready to Publish** - Content ready for publication (status: inspected/editing)
2. **Published** - Content already live (status: published_blog/news/both)

**Features:**

- Publish Now button → Cloud Function
- Schedule for later → Calendar scheduling
- Unpublish content
- Edit metadata

**Key Files:**

- `src/pages/admin/PublishedPage.jsx`

**Actions:**

- **Publish** → Cloud Function: `transitionContentStatus` (published_blog)
- **Unpublish** → Cloud Function: `unpublishContentToInspected`

---

### Calendar (`/admin/calendar`)

**Purpose:** Visual scheduling of content publication

**Features:**

- Month view calendar
- Drag-and-drop scheduling
- Double-click to schedule
- Time-of-day picker with explicit timezone handling (v1.5.0)
- Color-coded by status
- Filter by content type

**Key Files:**

- `src/pages/admin/CalendarPage.jsx`

---

### New in v1.5.0

- **Connections (`/admin/connections`)** — Publer, Plaud, Sessionize, Credly, and YouTube
  integrations in one place; Sessionize speaker ID lives in admin settings
  (`src/lib/adminSettings.js`). Key file: `src/pages/admin/ConnectionsPage.jsx`.
- **Linkie Hub (`/admin/linkie`)** — manage the Linkie link hub via the `linkieProxy`
  Cloud Function. Key file: `src/pages/admin/LinkiePage.jsx`.
- **Mailing List (`/admin/mailing-list`)** — Klaviyo list management and newsletter subscriber
  view via `klaviyoProxy` / `newsletterSubscribe`. Key file: `src/pages/admin/MailingListPage.jsx`.
- **Labs (`/admin/labs`)** — manage lab definitions and monitor Hostinger VPS runner jobs
  (Firestore job queue; see `documentation/labs-platform-guide.md`). Key file:
  `src/pages/admin/LabsPage.jsx`.
- **Pipeline stepper** — persistent Submit → Editor → Review → Published progress indicator across
  the publishing flow (`src/components/admin/PipelineStepper.jsx`).
- **Pre-publish validation checklist** — hero image, body length, slug uniqueness, and
  provider/type checks surfaced before publish.
- **"Auto-post to Social" at publish** — pre-fills SocialHub compose from the published item.
- Admin provider dropdowns now cover all **8 providers** (VMware and Ansible added).

**Pattern:** Backend handler for scheduling updates

```javascript
// PATTERN: backend handler for calendar scheduling
// See docs/admin-api-patterns.md
await postJSON('saveContentSchedule', {
  contentId: itemId,
  scheduledPublishDate: newDate.toISOString(),
});
```

---

## Content Workflows

### Workflow 1: Blog Post Submission

```
1. Submit URL (/admin/submit)
   ↓
2. Review in Queue (/admin/queue)
   - Verify title, description, tags
   - Approve → status: 'inspected'
   ↓
3. Edit in Editor (/admin/editor/:id)
   - Write/refine blog draft
   - Preview rendered output
   ↓
4. Publish (/admin/published)
   - Publish Now → status: 'published_blog'
   OR
   - Schedule → Calendar (/admin/calendar)
```

### Workflow 2: Rejecting Content

```
1. Review in Queue (/admin/queue/:id)
   ↓
2. Reject → status: 'rejected'
   ↓
3. Content moves to "Rejected" filter
   ↓
4. (Optional) Restore → status: 'ingested'
```

### Workflow 3: Batch Operations

```
1. Dashboard (/admin)
   ↓
2. Click "RSS Fetch" button
   ↓
3. Cloud Function: fetchRssContent
   - Fetches latest RSS items
   - Scrapes content
   - Saves to Firestore (status: 'ingested')
   ↓
4. Content appears in Queue
```

---

## API Patterns

The admin portal uses two primary patterns for data operations:

### Cloud Functions (Server-Side)

**When to use:**

- All admin mutations
- Status transitions
- Publishing operations
- Rejection/approval workflows
- Scheduling and prompt configuration
- Operations requiring validation or audit authority

**Example:**

```javascript
import { postJSON } from '@/lib/api';

await postJSON('transitionContentStatus', {
  contentId,
  newStatus: 'published_blog',
  markLive: true,
});
```

### Firestore / Snapshot Reads

**When to use:**

- Real-time reads of authorized admin data
- Backend snapshot endpoints for exact counts and health aggregates

**📖 Full decision matrix:** See [`docs/admin-api-patterns.md`](../archive/admin-api-patterns.md)

---

## Security Best Practices

### Authentication

✅ **Backend-Enforced Admin Authorization**

- Frontend: `src/config/admin.js` is UX only
- Backend: `functions/cms-functions.js` and Firestore rules are authoritative
- **CRITICAL:** Frontend config must never be treated as a security boundary

```javascript
// src/config/admin.js
export const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
```

### Firestore Security Rules

✅ **Protect Admin Collections**

```javascript
// firestore.rules
match /admin_audit_logs/{logId} {
  allow read: if isAdmin();
  allow write: if false;
}
```

### Audit Logging

✅ **Backend Owns Audit Authority**

```javascript
await postJSON('recordAdminAudit', {
  action: 'action_name',
  details: { contentId },
});
```

Client code may still read audit logs when authorized, but it should not create them directly.

**Typical logged fields:**

- `action` - Action name (e.g., 'draft_saved')
- `userId` - Firebase UID
- `userEmail` - Admin email
- `timestamp` - Server timestamp
- `details` - Custom context object
- `userAgent` - Browser/device info

---

## Adding New Features

### Code Review Checklist

Before merging new admin features, verify:

- [ ] **Configuration:** Uses `@/config/admin.js` for constants (not hardcoded)
- [ ] **API Pattern:** Uses backend handlers for admin mutations
- [ ] **Audit Logging:** Backend handler owns the audit event
- [ ] **Security Rules:** Firestore rules block direct client writes if not required
- [ ] **Documentation:** Inline comments reference `admin-api-patterns.md`
- [ ] **Environment Variables:** Updates `.env.example` if new config added
- [ ] **Build Success:** `npm run build` succeeds with no errors
- [ ] **Testing:** Manual testing checklist completed

### Example: Adding New Admin Page

```javascript
// src/pages/admin/NewFeaturePage.jsx
import React from 'react';
import { ADMIN_ROUTES } from '@/config/admin';
import { postJSON } from '@/lib/api';

export default function NewFeaturePage() {
  const handleUpdate = async (contentId, data) => {
    // PATTERN: backend handler for admin mutation
    // See docs/admin-api-patterns.md
    await postJSON('featureUpdated', {
      contentId,
      data,
    });
  };

  return <div>New Feature Content</div>;
}
```

---

## Troubleshooting

### Common Issues

#### Issue: "Access Denied" after signing in

**Cause:** User is not allowed through the frontend admin allowlist (UX gate) or backend admin
authorization (security gate).

**Solution:**

1. Confirm your Firebase Auth `uid` is in the production allowlist doc: `admins/approved.uids`.
2. For local/dev builds, set a frontend allowlist (UX-only) so `/admin` renders:
   - `VITE_ADMIN_EMAILS` and/or `VITE_ADMIN_UIDS`
   - or `VITE_OWNER_ADMIN_EMAIL` + `VITE_OWNER_ADMIN_UID` in `.env.local`
3. Rebuild/restart after `.env*` changes.

Notes:

- Frontend allowlists do not grant security; they only gate the admin UI locally.
- Backend handlers are the security boundary and will return `403` when not authorized.

---

#### Issue: Editor save not working

**Cause:** Backend handler validation failure or auth rejection

**Solution:**

1. Check the network response from `saveEditorDraft`
2. Verify user authenticated and recognized as admin
3. Check Cloud Functions logs for validation details

---

#### Issue: Build fails after changes

**Cause:** Import errors or TypeScript issues

**Solution:**

```bash
# Clear cache and rebuild
rm -rf node_modules/.vite
npm run build
```

---

#### Issue: Audit logs not appearing

**Cause:** Backend audit handler failure or read permission issue

**Solution:**

1. Check Firestore console for `admin_audit_logs` collection
2. Check the backend action handler completed successfully
3. Confirm the client is only reading logs, not trying to create them

---

### Debug Checklist

When debugging admin issues:

1. **Check Authentication**
   - User signed in? (Check Firebase console)
   - Email in ADMIN_EMAILS? (Check `.env`)

2. **Check Firestore Rules**
   - Rules deployed? (`firebase deploy --only firestore:rules`)
   - Rules allow operation? (Check Firebase console Rules Playground)

3. **Check Cloud Functions**
   - Function deployed? (`firebase deploy --only functions`)
   - Function logs? (`firebase functions:log`)
   - Environment variables set? (Firebase console Functions → Config)

4. **Check Browser Console**
   - JavaScript errors?
   - Network errors (failed API calls)?
   - React warnings?

---

## Environment Variables

### Required

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Admin Configuration (MUST match backend CMS_ADMIN_EMAILS)
VITE_ADMIN_EMAILS=email1@example.com,email2@example.com

# Cloud Functions URL
VITE_GCP_FUNCTIONS_URL=https://your-region-your-project.cloudfunctions.net
```

### Backend Sync

Admin access is enforced on the backend.

- **Production source of truth:** Firestore admin registry at `admins/approved` with field
  `uids: string[]`
- **Frontend `.env*` admin values:** UX-only (hide/show `/admin` routes locally); never treat as
  security
- **Backend allowlists/claims:** optional bootstrap; registry remains authoritative

---

## Reference

### Active Patterns (Use These)

- ✅ `src/lib/api.js` - Cloud Function wrapper
- ✅ `src/hooks/useFirestore.js` - Real-time Firestore hooks
- ✅ `src/lib/firebaseConfig.js` - Firebase initialization
- ✅ `src/config/admin.js` - Centralized admin configuration
- ✅ `src/lib/auditLog.js` - Audit logging helper

### Deprecated Patterns (Removed)

- ❌ `src/lib/functionsBase.js` - Removed (unused, 81 lines)
- ❌ `src/lib/firebase/firestore.ts` - Removed (unused, 515 lines)

### Key Firestore Collections

- `content` - All content items (blog, news, frameworks, architecture)
- `admin_audit_logs` - Audit logs for admin actions (backend-write only)
- `rss_sources` - RSS feed sources for batch fetching

---

## Further Reading

- [`admin-api-patterns.md`](../archive/admin-api-patterns.md) - Full API pattern documentation
- [`security-secrets-guide.md`](../archive/security-secrets-guide.md) - Secret management
- [Firebase Documentation](https://firebase.google.com/docs)
- [Cloud Functions Documentation](https://cloud.google.com/functions/docs)

---

**Last Updated:** February 2026 **Maintainer:** HybridCloudWorks Team
