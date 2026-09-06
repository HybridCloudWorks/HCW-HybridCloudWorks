# Firestore Data Population Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Prerequisites

1. **Firebase Service Account Key**
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file as `firebase-service-account.json` in the project root
   - **IMPORTANT**: Add this file to `.gitignore` (already done)

2. **Install Firebase Admin SDK**
   ```bash
   npm install firebase-admin --save-dev
   ```

## Running the Population Script

```bash
# Run the script
node scripts/populate-firestore.cjs
```

## What Gets Populated

The script creates the following Firestore structure:

```
firestore/
├── aws/
│   ├── blog/
│   │   └── articles/
│   │       ├── multi-region-resilient-architectures
│   │       └── aws-cost-optimization-2026
│   └── architectures/
│       └── designs/
│           └── multi-tier-web-application
├── azure/
│   ├── blog/
│   │   └── articles/
│   │       └── azure-landing-zones-enterprise
│   └── architectures/
│       └── designs/
│           └── hub-spoke-network-topology
├── gcp/
│   ├── blog/
│   │   └── articles/
│   │       └── building-ml-pipelines-vertex-ai
│   └── architectures/
│       └── designs/
│           └── data-lake-cloud-storage
└── metadata/
    └── stats
```

## Document Schema

### Blog Article

```javascript
{
  slug: string,
  title: string,
  description: string,
  content: string (HTML),
  author: string,
  date: string,
  category: string,
  tags: string[],
  readTime: number,
  published: boolean,
  createdAt: timestamp
}
```

### Architecture Design

```javascript
{
  slug: string,
  title: string,
  description: string,
  overview: string (HTML),
  category: string,
  complexity: string,
  tags: string[],
  estimatedCost: string,
  terraformCode: string (optional),
  diagramUrl: string (optional),
  published: boolean,
  createdAt: timestamp
}
```

## Firestore Security Rules

Ensure your `firestore.rules` allows read access:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow public read for published content
    match /{provider}/{contentType}/{collection}/{document} {
      allow read: if resource.data.published == true;
    }

    // Allow authenticated users to write
    match /{document=**} {
      allow write: if request.auth != null;
    }
  }
}
```

## Troubleshooting

### Error: "Cannot find module 'firebase-admin'"

```bash
npm install firebase-admin --save-dev
```

### Error: "Cannot find service account file"

- Ensure `firebase-service-account.json` exists in project root
- Or set environment variable: `FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json`

### Error: "Permission denied"

- Check that your service account has Firestore write permissions
- Verify Firebase project ID in the service account JSON

## Next Steps

After populating Firestore:

1. Update `useFirestore` hook paths to match collection structure
2. Deploy Firestore security rules: `firebase deploy --only firestore:rules`
3. Test data fetching in the application
4. Add more content as needed
