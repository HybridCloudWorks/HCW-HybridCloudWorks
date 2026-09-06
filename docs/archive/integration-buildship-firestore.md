# Integration: Buildship Firestore Setup

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 14, 2026 **Status:** ✅ Active & Tested **Purpose:** Configure Buildship
as a frontend UI for Firestore collections and manage data without code

---

## Overview

Buildship is a low-code/no-code platform that provides a UI frontend for managing Firestore
collections. It allows non-technical team members to view, edit, and manage database records without
accessing the Firebase Console directly.

### Buildship Collections Configured

| Collection         | Frontend UI            | Connected Pages                                 | Purpose                                                |
| ------------------ | ---------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| **certifications** | ✅ Buildship Dashboard | [About Page](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx) | Professional certifications, credentials, and licenses |

---

## Firestore Security Rules Configuration

For Buildship to access Firestore collections, the default deny rules must be modified to allow
service account authentication.

### Rules Update (February 14, 2026)

**File:** `platform/firebase/firestore.rules`

Added service account detection to allow admin tools like Buildship:

```rules
// Helper function to check if request is from a service account (for admin tools like Rowy, Buildship)
function isServiceAccount() {
  return request.auth.token.firebase.sign_in_provider == 'custom' ||
         request.auth.token.firebase.identities.size() == 0;
}

// Default deny, but allow service accounts (admin tools)
match /{document=**} {
  allow read, write: if isServiceAccount();
}
```

**Why This Works:**

- Buildship authenticates using a Firebase service account (not a regular user)
- Service accounts have `firebase.sign_in_provider == 'custom'`
- This rule allows only service accounts to bypass the default deny
- Individual collection rules still apply for frontend/app users

---

## Setup Steps

### 1. Connect Buildship to Firebase

1. Go to [Buildship](https://buildship.app)
2. Create or sign in to your workspace
3. Click **"Add Resource"** → **"Firebase Firestore"**
4. Select **"Connect Existing Firebase Project"**
5. Upload your Firebase service account JSON key:
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click **"Generate New Private Key"**
   - Save the JSON file
   - Upload to Buildship

### 2. Add Collections to Buildship

1. In Buildship, click **"Add Collection"**
2. Select the Firestore database
3. Choose the collection to expose (e.g., `certifications`)
4. Configure field mappings and display options
5. Set permissions (read-only, edit, etc.)

### 3. Deploy Rules

After connecting Buildship, deploy the updated Firestore rules:

```bash
firebase deploy --only firestore:rules
```

---

## Connected Pages

### Certifications Collection

**Frontend Page:** [About Page](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx)

**Purpose:**

- Display professional certifications grouped by issuer
- Show certification badges, issue dates, expiration dates
- Provide verification links
- Support public read access for portfolio

**Firestore Collection Rules:**

```rules
match /certifications/{certId} {
  allow read: if true; // Public read for portfolio display
  allow create, update, delete: if isAuthenticated();
}
```

**Buildship Editing:**

- Manage certifications without Firebase Console
- Add/edit/delete certs with validated form
- Upload badge images
- Set display order and visibility

---

## Data Structure (Certifications)

```json
{
  "id": "cert-id-12345",
  "name": "Certified Kubernetes Administrator",
  "issuer": "Microsoft Azure",
  "code": "AZ-900",
  "issue_date": "2024-01-15",
  "exp_date": "2026-01-15",
  "certState": true,
  "verify_url": "https://...",
  "image_url": "https://...",
  "display": true,
  "display_order": 1,
  "tags": ["kubernetes", "certification"]
}
```

---

## Troubleshooting

### "Access Denied" Error in Buildship

**Cause:** Service account credentials not correctly configured

**Solution:**

1. Verify Firebase service account JSON key is valid
2. Check that Firestore security rules include service account check:
   ```rules
   function isServiceAccount() {
     return request.auth.token.firebase.sign_in_provider == 'custom' ||
            request.auth.token.firebase.identities.size() == 0;
   }
   ```
3. Redeploy rules: `firebase deploy --only firestore:rules`
4. Wait 30 seconds and refresh Buildship

### Collection Not Appearing in Buildship

**Cause:** Collection not yet created in Firestore

**Solution:**

1. Create the collection manually in Firebase Console or through your app
2. Add at least one document to the collection
3. Refresh Buildship and re-add the collection

### Firestore Rules Compilation Error

**Cause:** Invalid rules syntax

**Solution:**

1. Validate rules locally: `firebase emulators:start`
2. Check for typos in function definitions
3. Ensure all curly braces and semicolons match

---

## Security Best Practices

✅ **Currently Implemented:**

- Default deny rule (`allow read, write: if false;`)
- Service account authentication required for admin tools
- Individual collection rules override default
- Public read-only access to portfolio collections

⏳ **Future Enhancements:**

- Add audit logging for all Buildship edits
- Implement per-user role-based access control (RBAC)
- Add IP whitelisting for Buildship service account
- Monitor for unauthorized access attempts

---

## Related Documentation

- [Firebase Architecture](../archive/frontend-firebase-architecture.md)
- [Firestore Population Guide](../archive/database-firestore-population.md)
- About Page Implementation *(historical target unavailable)*

---

## Support

For issues with Buildship:

- [Buildship Documentation](https://docs.buildship.app)
- [Firebase Rules Documentation](https://firebase.google.com/docs/firestore/security/get-started)

For Firestore queries and data management, see the Firebase Console:
https://console.firebase.google.com/project/hybridcloudworks-61e8d/firestore
