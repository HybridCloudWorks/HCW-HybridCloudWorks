# Deployment Handover Checklist

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Project Overview

**HybridCloudWorks** is a production-ready Vite + React SPA deployed on Firebase Hosting. This guide
provides all necessary information for deployment, maintenance, and future development.

## Quick Start

### Prerequisites

- Node.js 20.x (match `package.json` engines)
- Firebase CLI (`npm install -g firebase-tools`)
- GCP service account key with Firebase admin privileges

### Build & Deploy

```bash
# Install dependencies
npm ci

# Run development server
npm run dev                          # http://localhost:5173

# Production build
npm run build                        # Outputs to dist/

# Test build locally
npm run preview                      # Preview dist/ on port 4173

# Deploy to Firebase
firebase deploy --only hosting      # Deploy to hybridcloudworks.com

# Deploy with specific project
firebase deploy --project hybridcloudworks-61e8d --only hosting
```

## Required GitHub Secrets

Configure these in `Settings > Secrets and variables > Actions`:

### Firebase Configuration (Required)

- `VITE_FIREBASE_API_KEY` - Firebase API key
- `VITE_FIREBASE_AUTH_DOMAIN` - Auth domain (e.g., `hybridcloudworks-61e8d.firebaseapp.com`)
- `VITE_FIREBASE_PROJECT_ID` - GCP project ID (`hybridcloudworks-61e8d`)
- `VITE_FIREBASE_STORAGE_BUCKET` - Storage bucket (e.g., `hybridcloudworks-61e8d.appspot.com`)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` - Firebase messaging sender ID
- `VITE_FIREBASE_APP_ID` - Firebase app ID
- `VITE_FIREBASE_MEASUREMENT_ID` - Google Analytics measurement ID (optional)

### Deployment Secrets (Required)

- `GCP_SA_KEY` - GCP service account JSON key (base64 encoded or raw JSON)
- `FIREBASE_PROJECT_ID` - Same as above (`hybridcloudworks-61e8d`)

### Optional Secrets

- `VITE_ADMIN_EMAIL` - Admin contact email for features page

## Firebase Project Configuration

### Project ID

```
hybridcloudworks-61e8d
```

### `.firebaserc` Configuration

```json
{
  "projects": {
    "default": "hybridcloudworks-61e8d",
    "production": "hybridcloudworks-61e8d"
  },
  "targets": {
    "hybridcloudworks-61e8d": {
      "hosting": ["hybridcloudworks"]
    }
  }
}
```

### Firestore Configuration

- **Rules file**: `firestore.rules`
- **Indexes file**: `firestore.indexes.json`
- **Deploy rules**: `firebase deploy --only firestore:rules`

### Cloud Storage Configuration

- **Rules file**: `storage.rules`
- **Deploy rules**: `firebase deploy --only storage`

### Hosting Configuration

- **Build output directory**: `dist/` (not `build/`)
- **Rewrite rules**: SPA routing → `/index.html`
- **Cache headers**:
  - Static assets (`.js`, `.css`, `.woff2`): 1 year (immutable)
  - HTML: 1 hour with must-revalidate

## CI/CD Pipeline

### GitHub Actions Workflows

#### `frontend-deploy.yml` (Main Deployment)

- **Triggers**: Push to `main`, manual dispatch, PRs
- **Steps**:
  1. Lint & test (`npm run lint`, `npm test`)
  2. Security scanning (Trivy)
  3. Build production bundle (`npm run build`)
  4. Bundle size analysis
  5. Preview smoke test
  6. E2E tests (Playwright)
  7. Deploy to Firebase (PR preview or production)
  8. Health checks (200 response, content validation)

#### `code-quality.yml`

- Runs on every PR to `main`
- Checks: ESLint, Prettier, React validation, coverage
- Blocks merge if issues found

#### `security-scan.yml`

- Weekly + on-demand
- Scans: npm dependencies, Python packages (if present), secrets, IaC

#### `ci-helm-lint.yml`

- Conditional: Only runs if Kubernetes charts exist
- Currently disabled (K8s charts archived)

## Build & Deployment Pipeline

### Development Workflow

```
npm install          # Install deps
npm run dev          # Local development
npm run lint         # Check code quality
npm test             # Run tests
npm run build        # Production build
npm run preview      # Test production build
```

### Production Build Output

- **Directory**: `dist/`
- **Entry point**: `dist/index.html`
- **Bundle size**: ~500KB (gzipped with tree-shaking)
- **Modules**: 2233 transformed by Vite

### Health Checks

Post-deployment, verify:

```bash
curl https://hybridcloudworks.com                    # Should return 200
curl https://hybridcloudworks.com | grep 'id="root"'  # Should contain React root
```

## Firestore Integration

### Collections Structure

- `certifications` - User certifications (read/write controlled)
- Custom collections per page type (architecture, blog, resources, etc.)

### Security Rules

```
- Public read access for content collections
- Admin-only write access (verified via request.auth.token.admin)
- Document-level security via email field matching
```

### Querying Data

```javascript
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';

// Example: Fetch certifications
const ref = collection(db, 'certifications');
const snap = await getDocs(ref);
```

## Design System

### Color Scheme

- **Base dark**: `#0a0f1a` (background), `#0d1526` (secondary)
- **Accent**: `#137fec` (blue)
- **Provider themes**: Automatically applied via context class (e.g., `theme-aws`)

### Provider Colors

- AWS: `#FF9900` (orange)
- Azure: `#0078D4` (blue)
- GCP: `#EA4335` (red)
- GitHub: `#24292F` (dark gray)
- Terraform: `#7B42BC` (purple)
- FinOps: `#1EA482` (green)

### CSS Variables

All available in `src/index.css`:

- `--hcw-bg-primary`, `--hcw-accent`, `--hcw-text-primary`, etc.
- Glassmorphism: `.glass-card`, `.glass-button`
- Shadows: `--hcw-shadow-sm`, `--hcw-shadow-md`, `--hcw-shadow-lg`

## Rollback Procedure

If deployment fails or issues arise:

```bash
# 1. List recent deployments
firebase hosting:channel:list --project hybridcloudworks-61e8d

# 2. View deployment history
firebase hosting:versions:list --project hybridcloudworks-61e8d

# 3. Rollback to previous version
firebase hosting:rollback --project hybridcloudworks-61e8d

# Or manually re-deploy a working commit
git checkout <commit-hash>
npm ci
npm run build
firebase deploy --only hosting --project hybridcloudworks-61e8d
```

## Environment Variables

### Required for Build

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Local Development

Create `.env.local` (not committed):

```
VITE_FIREBASE_API_KEY=your_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_domain_here
...
```

## Maintenance

### Regular Tasks

**Weekly**

- Check GitHub Actions: Ensure all workflows pass
- Monitor Firebase: Console for errors, quota usage
- Review Firestore: Check data consistency

**Monthly**

- Security scanning: Review Trivy results
- Dependency updates: `npm outdated`, review PRs
- Performance: Check Firebase Hosting analytics

**Quarterly**

- Full security audit (penetration testing considerations)
- Performance profiling (Lighthouse, Core Web Vitals)
- Disaster recovery test (restore from backup)

### Common Issues & Solutions

| Issue                            | Solution                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Build fails with "ENOENT: dist/" | Run `npm run build` locally to verify, check `firebase.json` points to `dist/`       |
| Deployment times out             | Check GCP service account permissions, Firebase project quota                        |
| Secrets not loading              | Verify GitHub Secrets are set, check `frontend-deploy.yml` for typos                 |
| Content not updating             | Clear browser cache (Ctrl+Shift+Del), verify Firestore rules, check collection names |
| CSS not applying                 | Verify provider context is properly set, check Tailwind purge config                 |

## Monitoring & Analytics

### Firebase Console

- **Hosting**: https://console.firebase.google.com/project/hybridcloudworks-61e8d/hosting
- **Firestore**: Real-time read/write metrics
- **Storage**: Usage and traffic patterns
- **Functions**: Execution logs and errors

### Google Analytics

- Configured via `VITE_FIREBASE_MEASUREMENT_ID`
- Track page views, user engagement, custom events

## Documentation

- **Architecture**: `documentation/architecture-system-overview.md`
- **Firebase Setup**: `documentation/frontend-firebase-architecture.md`
- **Stitch Mapping**: `documentation/frontend-stitch-mapping.md`
- **Routing**: `documentation/architecture-system-overview.md`

## Contact & Support

For issues or questions:

- **Email**: `hello@hybridcloudworks.com`
- **GitHub Issues**: https://github.com/saulpw/hybridcloudworks/issues
- **Firebase Support**: https://firebase.google.com/support

## Version Information

- **Node.js**: 20.x (LTS)
- **npm**: 10.x
- **React**: 18.x
- **Vite**: 7.x
- **Firebase**: 11.x
- **Tailwind CSS**: 3.x

---

**Last Updated**: February 10, 2025 **Maintainer**: Saul Patino **Status**: Production Ready

---

## Consolidated from `frontend-firebase-deployment.md`

_Merged 2026-05-27 during documentation reorganization. Original archived at
`archive/docs/frontend-firebase-deployment.md`._

# Firebase Deployment Guide

## Prerequisites

1. **Firebase CLI**

   ```bash
   npm install -g firebase-tools
   ```

2. **Firebase Login**

   ```bash
   firebase login
   ```

3. **Initialize Firebase (if not done)**
   ```bash
   firebase init
   # Select: Hosting, Firestore, Storage
   # Choose existing project or create new one
   ```

## Deployment Steps

### 1. Build the Application

```bash
npm run build
```

This creates an optimized production build in the `dist/` directory.

### 2. Test Locally (Optional)

```bash
firebase serve
```

Visit `http://localhost:5000` to test the production build locally.

### 3. Deploy to Firebase Hosting

```bash
# Deploy everything (hosting + firestore rules + storage rules)
firebase deploy

# Or deploy specific services:
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

### 4. View Your Live Site

After deployment, Firebase will provide a URL:

```
https://your-project-id.web.app
https://your-project-id.firebaseapp.com
```

## Custom Domain Setup

1. **Add Custom Domain**

   ```bash
   firebase hosting:channel:deploy production
   ```

2. **In Firebase Console**
   - Go to Hosting → Add custom domain
   - Follow DNS verification steps
   - Add provided DNS records to your domain registrar

3. **SSL Certificate**
   - Firebase automatically provisions SSL certificates
   - Usually takes 24-48 hours for DNS propagation

## Environment Variables

Ensure these are set in your `.env.production` file:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## Deployment Checklist

- [ ] Build passes locally (`npm run build`)
- [ ] All environment variables configured
- [ ] Firestore security rules updated
- [ ] Storage security rules updated
- [ ] Firebase project selected (`firebase use <project-id>`)
- [ ] Test deployment with `firebase serve`
- [ ] Deploy to production
- [ ] Verify live site functionality
- [ ] Check authentication flows
- [ ] Test Firestore data fetching
- [ ] Verify all routes work correctly

## CI/CD with GitHub Actions

Create `.github/workflows/firebase-deploy.yml`:

```yaml
name: Deploy to Firebase Hosting

on:
  push:
    branches:
      - main

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}

      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          channelId: live
          projectId: your-project-id
```

## Rollback

If you need to rollback to a previous version:

```bash
# List previous deployments
firebase hosting:clone

# Rollback to specific version
firebase hosting:clone <source-site-id>:<source-version-id> <target-site-id>
```

## Monitoring

- **Firebase Console**: Monitor hosting metrics, bandwidth, and requests
- **Google Analytics**: Track user behavior (if configured)
- **Performance Monitoring**: Add Firebase Performance SDK for detailed metrics

## Troubleshooting

### Build Fails

- Check all dependencies are installed
- Verify environment variables are set
- Review build logs for specific errors

### 404 Errors on Routes

- Ensure `firebase.json` has proper rewrites configuration
- SPA routing requires all routes to redirect to `index.html`

### Authentication Not Working

- Verify Firebase Auth is enabled in console
- Check authorized domains in Firebase Console → Authentication → Settings
- Add your custom domain to authorized domains

### Firestore Data Not Loading

- Check Firestore security rules
- Verify collection paths match code
- Check browser console for errors
