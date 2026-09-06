# DATABASE-FIRESTORE-COLLECTIONS

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 15, 2026
**Status:** 📋 Complete Integration & Code Reference
**Purpose:** Complete reference for Firestore collection schemas, field-by-field code usage mapping,
Rowy/BuildShip UI configuration, and data flow architecture

---

## Overview

**Rowy** (part of BuildShip suite) is a low-code/no-code frontend that provides a spreadsheet-like
UI for managing Firestore collections. It acts as a Visual CMS without requiring code changes.

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB BROWSER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────┐         ┌──────────────────────┐      │
│  │   React Frontend     │         │  Rowy/BuildShip UI   │      │
│  │  (AboutPage, etc)    │         │   (Admin Dashboard)  │      │
│  └──────────┬───────────┘         └──────────┬───────────┘      │
│             │ reads data                      │ edits data       │
└─────────────┼──────────────────────────────────┼─────────────────┘
              │                                  │
              │ Firebase SDK (getDocs)          │ Service Account
              │                                  │ (write/update)
              ▼                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│         FIRESTORE CLOUD DATABASE (Project: hybridcloudworks)     │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Collections:                                                     │
│  ├── certifications          ◄── Rowy edits → Shows on About     │
│  ├── speakerevents           ◄── Rowy edits → Shows on About     │
│  ├── episodes                ◄── Rowy edits → Shows on page      │
│  ├── blogs                   ◄── Rowy edits → Shows on page      │
│  ├── content/pages           ◄── Rowy edits → ContentForge       │
│  ├── frameworks              ◄── Rowy manages → Site search      │
│  ├── config/*                ◄── Rowy manages → App config       │
│  └── ...                                                          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Firestore Security Model

### Service Account Detection

The Firestore rules allow **service accounts** (used by Rowy/BuildShip) to bypass user
authentication:

```firebase-rules
function isServiceAccount() {
  return request.auth.token.firebase.sign_in_provider == 'custom' ||
         request.auth.token.firebase.identities.size() == 0;
}

// Default: Allow service accounts, deny others
match /{document=**} {
  allow read, write: if isServiceAccount();
}
```

**Why?** Rowy uses a Firebase service account to authenticate (not user login), allowing it to
modify data while the frontend app has its own stricter rules.

---

## Collections Map

### 1. PUBLIC COLLECTIONS (Read: Everyone, Write: Service Account Only)

#### `certifications`

**Firestore Path:** `/certifications/{certId}`

**Purpose:** Professional credentials, licenses, and certifications

**Firestore Schema:**

```javascript
{
  id: "string",                          // Auto-generated Doc ID
  name: "string",                        // Cert name (e.g., "Azure Administrator")
  code: "string",                        // Cert code (e.g., "AZ-104")
  issuer: "string",                      // Issuer name (e.g., "Microsoft")
  issuerUrl: "string",                   // Link to issuer profile/verification
  issuerLogo: "string",                  // URL to issuer logo
  credentialUrl: "string",               // Link to verify credential
  credentialImage: "string",             // URL to credential badge/image
  issueDate: "timestamp",                // When obtained
  expiryDate: "timestamp",               // When expires (optional)
  display: "boolean",                    // Show in UI?
  display_order: "number",               // Sort order within issuer group
  createdAt: "timestamp",                // Record creation time
  updatedAt: "timestamp"                 // Last modified time
}
```

**Real Example (Google Certified Associate):**

```javascript
{
  id: "gcp-associate-2024",
  name: "Google Cloud Associate Cloud Engineer",
  code: "ACE",
  issuer: "Google Cloud",
  issueDate: Timestamp(2024, 6, 15),
  expiryDate: Timestamp(2026, 6, 15),
  credentialImage: "https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/certifications%2FgcpId%2FcredentialImage%2Fgoogle-cert.png",
  credentialUrl: "https://www.credential.net/...",
  issuerUrl: "https://cloud.google.com/",
  display: true,
  display_order: 2
}
```

**Frontend Component:** [AboutPage.jsx](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx)

**Data Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│ FIRESTORE DOCUMENT: certifications/gcp-associate-2024           │
├─────────────────────────────────────────────────────────────────┤
│ { name, code, issuer, credentialImage, credentialUrl, ... }     │
└────────────────┬────────────────────────────────────────────────┘
                 │ getDocs() [Line 251]
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ normalizeCertification() [Lines 5-118]                           │
│  - Resolve image URL (downloadURL vs simple URL) [Lines 35-70]  │
│  - Parse dates (Firestore to JS Date) [Line 24]                 │
│  - Map field names to canonical names                           │
└────────────────┬────────────────────────────────────────────────┘
                 │ returns normalized cert object
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ Filter & Group [Lines 269-305]                                  │
│  - Filter: display === true                                     │
│  - Sub-group by issuer code (Microsoft → Azure/365/Other)       │
│  - Sort by display_order [Line 309]                             │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ CertificationCard Component [Lines 121-240]                     │
│  ├─ image_url → <img> badge [Lines 159-170]                    │
│  ├─ name → <h4> title [Line 198]                               │
│  ├─ code → Code badge bottom-right [Lines 216-220]             │
│  ├─ verify_url → Green checkmark link [Lines 210-215]          │
│  └─ issue_date/exp_date → Date display [Lines 200-207]         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
         ┌──────────────────┐
         │ About Page (UI)  │
         │ Certification    │
         │ grid display     │
         └──────────────────┘
```

---

## Field-by-Field Code Usage Reference

### `name` Field

**Rowy Column:** Short Text (required)
**Firestore Field Names Checked:** `name`, `Name` [Line 92]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Normalized [Line 92]
name: get(raw, ['name', 'Name']),

// 2. Displayed as card title [Line 198]
<h4 className="...text-slate-900 dark:text-white font-bold...">
  {cert.name}
</h4>

// 3. Used in image alt text [Line 169]
alt={`${cert.issuer} badge`}

// 4. Error logging context [Line 176]
console.error('Image load failed for:', cert.name, cert.image_url);
```

**Frontend Rendering:** Bold text, 2-line max, dark text on about page certification card

---

### `code` Field

**Rowy Column:** Short Text (required)
**Firestore Field Names Checked:** `code`, `Code` [Line 100]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Normalized [Line 100]
code: get(raw, ['code', 'Code']),

// 2. Microsoft issuer grouping logic [Lines 274-285]
const isM365 = code.includes('MS-') || code.includes('AB-');
const isAzure = code.includes('AZ-') || code.includes('DP-');

// 3. Displayed as monospace badge [Lines 216-220]
{cert.code && (
  <div className="...text-xs font-mono...">
    {cert.code}
  </div>
)}
```

**Firestore Usage:** Used to automatically sub-categorize Microsoft certifications:

- `AZ-*`, `DP-*`, `SC-*`, `PL-*`, `AI-*` → "Microsoft Azure"
- `MS-*`, `AB-*` → "Microsoft 365"
- Others → "Microsoft"

**Frontend Rendering:** Monospace text in small gray badge, bottom-right of card

---

### `issuer` Field

**Rowy Column:** Select dropdown
**Firestore Field Names Checked:** `issuer`, `Issuer` [Line 93]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Normalized with typo correction [Lines 93-108]
issuer: (() => {
  const iv = get(raw, ['issuer', 'Issuer']);
  if (Array.isArray(iv)) return iv[0] ?? 'Other';
  if (iv === 'Microsft') return 'Microsoft'; // Typo handling
  if (low === 'google cloud partners') return 'Google Cloud Partners';
  return iv;
})(),

// 2. Grouping certificates by issuer [Lines 313-322]
const certificationsByIssuer = useMemo(() => {
  const groupedCerts = certifications.reduce((acc, cert) => {
    const issuer = cert.issuer || 'Other';
    if (!acc[issuer]) acc[issuer] = [];
    acc[issuer].push(cert);
    return acc;
  }, {});

// 3. Rendering issuer sections [Lines 409-437]
{Object.entries(certificationsByIssuer).map(([issuer, certs]) => (
  <IssuerSection issuer={issuer} certs={certs} />
))}
```

**Frontend Rendering:** Expandable sections grouped by issuer name (Microsoft, Google Cloud, AWS,
etc.)

---

### `credentialImage` (or `image_url`)

**Rowy Column:** Image upload field
**Firestore Field Names Checked:** `image`, `Image`, `badge`, `Badge`, `imageUrl`, `ImageUrl` [Lines
46-71]

**How It's Used:**

```javascript
// AboutPage.jsx - Complex URL resolution [Lines 35-70]

const resolveImageUrl = () => {
  // Priority 1: Complex object from Firestore (array of objects)
  let complexData = get(raw, ['image', 'Image', 'badge', 'Badge']);
  if (Array.isArray(complexData)) {
    complexData = complexData.length > 0 ? complexData[0] : undefined;
  }

  // Extract downloadURL, downloadUrl, url, src, link
  if (complexData && typeof complexData === 'object') {
    const urlCandidate = complexData.downloadURL || complexData.url;
    return cleanUrl(urlCandidate);
  }

  // Priority 2: Simple string URL field
  const simpleUrl = get(raw, ['imageUrl', 'ImageUrl']);
  return cleanUrl(simpleUrl);
};

// CertificationCard - Display badge [Lines 155-177]
{
  cert.image_url ? (
    <button
      onClick={() => onImageClick(cert.image_url)} // Click to modal
      className="...flex items-center justify-center..."
    >
      <img
        src={cert.image_url}
        alt={`${cert.issuer} badge`}
        className={`w-full h-full object-contain ${isRetired || isExpired ? 'grayscale opacity-60' : ''}`}
        onError={(e) => {
          e.target.style.opacity = '0.5';
          e.target.setAttribute('alt', 'Image Failed');
        }}
      />
    </button>
  ) : (
    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800...">
      <span>image_not_supported</span>
    </div>
  );
}
```

**Storage Location:** Firebase Cloud Storage
**Path Pattern:**
`gs://hybridcloudworks-61e8d.appspot.com/certifications/{docId}/credentialImage/{filename.png}`

**Frontend Rendering:**

- 16×16px square badge in card header
- Clickable → Opens modal with full-size image
- Error handling: Shows placeholder if image fails to load
- Grayscale effect applied if cert is expired/retired

---

### `issueDate` Field

**Rowy Column:** Date picker
**Firestore Field Names Checked:** `issueDate`, `issue_date`, `IssueDate` [Line 97]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Parse Firestore timestamp to JS Date [Lines 22-27]
const toDate = v => {
  if (!v) return undefined;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v === 'string') return new Date(v);
  return undefined;
};

// 2. Store in normalized object [Line 97]
issue_date: toDate(get(raw, ['issueDate', 'issue_date', 'IssueDate'])),

// 3. Determine if expired [Line 114]
const issueDate = cert.issue_date ? new Date(cert.issue_date) : null;

// 4. Format and display [Lines 115-117]
const formattedDate = (expDate || issueDate).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'short', // "Jan", "Feb"
});
```

**Frontend Rendering:** Formatted as "Jan 2024" in gray text with calendar icon, card bottom

---

### `expiryDate` Field

**Rowy Column:** Date picker (optional)
**Firestore Field Names Checked:** `expDate`, `exp_date`, `ExpDate` [Line 98]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Parse
exp_date: toDate(get(raw, ['expDate', 'exp_date', 'ExpDate'])),

// 2. Check expiration status [Line 120]
const isExpired = expDate && expDate < new Date();

// 3. Display "Expired" watermark [Lines 146-149]
{(isRetired || isExpired) && (
  <div className="cert-watermark text-slate-500 dark:text-slate-400">
    {isRetired ? 'Retired' : 'Expired'}
  </div>
)}

// 4. Apply grayscale styling [Line 170]
className={`... ${isRetired || isExpired ? 'grayscale opacity-60' : ''}`}
```

**Special Logic:**

- If `exp_date < today` → Shows "Expired" watermark, grayscales image
- If no expiry date → No expiration indicator (assumed always valid)

**Frontend Rendering:** Red "Expired" watermark overlaid on card, badge grayed out

---

### `credentialUrl` (verify_url)

**Rowy Column:** URL field
**Firestore Field Names Checked:** `verifyUrl`, `verify_url`, `VerifyUrl` [Line 103]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Normalize
verify_url: get(raw, ['verifyUrl', 'verify_url', 'VerifyUrl']),

// 2. Render verification link [Lines 210-215]
{cert.verify_url ? (
  <a
    href={cert.verify_url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700..."
  >
    <span className="material-symbols-outlined">check_box</span>
  </a>
) : (
  <div />
)}
```

**Frontend Rendering:** Green checkmark icon (clickable) at bottom-left of card, links to issuer
verification page

---

### `display` Field

**Rowy Column:** Checkbox
**Firestore Field Names Checked:** `display`, `Display` [Line 109]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Filter for display [Line 263]
.filter(cert => cert.display === true)

// Only certs with display=true show on page
```

**Frontend Impact:** If `display === false`, cert completely hidden from About page (not rendered at
all)

---

### `display_order` Field

**Rowy Column:** Number input
**Firestore Field Names Checked:** `displayOrder`, `display_order`, `DisplayOrder`, defaults to 999
[Line 108]

**How It's Used:**

```javascript
// AboutPage.jsx

// 1. Sort within each issuer group [Lines 309-311]
certItems.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));

// Lower numbers appear first
// Unmapped certs default to 999 (appear last)
```

**Frontend Rendering:** Controls position in certification card grid (0-9 appear first, 999 as
fallback)

---

### `certState` / `isValid` Fields

**Rowy Column:** Checkbox
**Firestore Field Names Checked:** `certState`, `isValid`, `is_valid`, `cert_state` [Lines 101-102]

**How It's Used:**

```javascript
// AboutPage.jsx - Retired cert logic [Lines 112-120]
const isRetired =
  cert.certState === false ||
  cert.is_valid === false ||
  cert.isValid === false ||
  cert.cert_state === false;

// Display retired watermark and grayscale [Lines 146-149, 170]
{
  (isRetired || isExpired) && (
    <div className="cert-watermark">{isRetired ? 'Retired' : 'Expired'}</div>
  );
}
```

**Frontend Rendering:** Shows "Retired" watermark, grayscales image and badge

---

### `tags` & `createdAt` / `updatedAt` Fields

**Rowy Columns:** Array field, Timestamps
**Stored but not currently displayed in UI**

---

---

#### `speakerevents`

**Firestore Path:** `/speakerevents/{eventId}`

**Purpose:** Speaking engagements, conference talks, webinar appearances

**Firestore Schema:**

```javascript
{
  id: "string",                          // Auto-generated Doc ID
  name: "string",                        // Event name (e.g., "AWS Summit NYC")
  description: "string",                 // Event description (talk abstract)
  date: "timestamp",                     // Event date (or startsAt if from Sessionize)
  location: "string",                    // City/venue name (or coordinates)
  location_coords: "object",             // { lat: number, lng: number }
  eventUrl: "string",                    // Link to event website
  presentationUrl: "string",             // Link to slides/recording
  eventImageUrl: "string",               // URL to event photo/logo
  display: "boolean",                    // Show in UI?
  isManualEntry: "boolean",              // Added via Rowy (not from Sessionize)
  createdAt: "timestamp",                // Record creation time
  updatedAt: "timestamp"                 // Last modified time
}
```

**Real Example (Speaking Engagement):**

```javascript
{
  id: "kcd-2026-chicago",
  name: "KCD Chicago 2026",
  description: "Keynote: Kubernetes Cost Optimization in Multi-Cloud Environments",
  date: Timestamp(2026, 3, 15),
  location: "Chicago, IL",
  location_coords: { lat: 41.8781, lng: -87.6298 },
  eventUrl: "https://community.cncf.io/events/kcd-chicago-2026/",
  presentationUrl: "https://www.youtube.com/watch?v=...",
  eventImageUrl: "https://firebasestorage.googleapis.com/v0/b/.../kcd-logo.png",
  display: true,
  isManualEntry: false
}
```

**Frontend Component:** CustomSessionizeWidget.jsx *(historical target unavailable)*

**Data Merge Strategy:**

The widget pulls from **two sources** and intelligently merges them:

```
┌─────────────────────────────────────────────────────────────────┐
│ SOURCE 1: Sessionize API [Line 187]                             │
│ fetch('https://sessionize.com/api/speaker/json/{speakerId}')    │
│ Speaker ID: c6yicoezls                                          │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌─────────────────────────────────────────────────────────────────┐
│ SOURCE 2: Firestore speakerevents [Lines 202-210]               │
│ getDocs(collection(db, 'speakerevents')) or 'Speakerevents'     │
│ Filter: display === true                                        │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ MERGE LOGIC [Lines 218-245]                                     │
│ - Match by event name (exact, lowercase)                        │
│ - Firestore overrides Sessionize if names match                 │
│ - Unmatched Firestore entries added as manual events            │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌─────────────────────────────────────────────────────────────────┐
│ LOCATION RESOLUTION [Lines 76-106]                              │
│ 1. If location is coordinates → Reverse geocode to city name    │
│ 2. Cache results in localStorage                                │
│ 3. Format: "City, State" or "City, Country"                     │
└────────────────┬────────────────────────────────────────────────┘
                 │
┌─────────────────────────────────────────────────────────────────┐
│ SORT BY DATE [Lines 328-345]                                    │
│ - Upcoming first (by date ascending)                            │
│ - Current year past events                                      │
│ - Previous year events                                          │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ renderSession() Component [Lines 356-600]                       │
│  ├─ name → <h4> title [Line 437]                               │
│  ├─ eventUrl → Language/globe icon link [Lines 446-451]         │
│  ├─ presentationUrl → Play icon link [Lines 452-461]            │
│  ├─ eventImageUrl → 20×20px image thumbnail [Lines 488-500]     │
│  ├─ description → Text with expand [Lines 471-520]              │
│  ├─ location → Location icon + Google Maps link [Lines 545-568] │
│  └─ date → Calendar icon + formatted date [Lines 569-580]       │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
     ┌──────────────────────────┐
     │ About Page Speaking      │
     │ Engagements Grid         │
     │ (Upcoming, Current, Past)│
     └──────────────────────────┘
```

---

## Field-by-Field Code Usage Reference (SpeakingEvents)

### `name` Field

**Rowy Column:** Short Text (required)
**Firestore Field Names Checked:** `name`, `title`, `Name` [Line 421]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Sessionize API returns 'name' or 'title' [Line 421]
const eventName = (sessionizeEvent.name || sessionizeEvent.title || '').trim();

// 2. Merge key: Match with Firestore entries [Lines 228-231]
let normalizedEventName = eventName.toLowerCase();
let customData = customEventsMap.get(normalizedEventName);

// Handle " (copy)" suffix from Rowy duplicates [Lines 233-240]
if (!customData && normalizedEventName.endsWith(' (copy)')) {
  const correctedName = normalizedEventName.replace(' (copy)', '').trim();
  customData = customEventsMap.get(correctedName);
}

// 3. Display in card title [Line 437]
<h4 className="text-slate-900 dark:text-white font-semibold text-lg">{displayName}</h4>;

// 4. Image alt text [Line 496]
alt = { displayName };
```

**Key Feature:** Event names from Sessionize and Firestore must match **exactly** (case-insensitive)
to merge data!

**Frontend Rendering:** Bold text, heading of each event card

---

### `description` Field

**Rowy Column:** Long Text
**Firestore Field Names Checked:** `description`, `Description` [Line 472]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Prefer Firestore custom description, fallback to Sessionize [Line 472]
const description = customData.description ||
                    session.description ||
                    'Event description not available';

// 2. Display with expand/collapse [Lines 485-520]
<div className="flex-grow">
  {(!isPreviousYear || isExpanded) && (
    <p className={`text-sm text-slate-700... ${isExpanded ? '' : 'line-clamp-4'}`}>
      {description}
    </p>
  )}

  // Show expand button if > 200 chars [Line 510]
  {typeof description === 'string' && description.length > 200 && (
    <button onClick={() => setExpandedCard(...)}>
      {isExpanded ? 'Show less' : '...'}
    </button>
  )}
</div>
```

**Special Logic:**

- **Current year events:** Shows description by default
- **Previous year (2025) events:** Description hidden unless card expanded
- **Expand threshold:** If > 200 characters, shows "..." button

**Frontend Rendering:** Gray text, expandable with "..." button if long

---

### `date` Field

**Rowy Column:** Date picker
**Firestore Field Names Checked:** `date`, `Date` [Line 430]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Get date from Firestore or Sessionize [Line 430]
const displayDate = customData.date || session.startsAt || session.date;

// 2. Categorize events by date [Lines 365-390]
const currentDate = new Date();

const comingSoonEvents = sessions.filter((s) => {
  const d = s.date || s.startsAt;
  return new Date(d) > currentDate;
});

const currentYearPastEvents = sessions.filter((s) => {
  const dt = new Date(d);
  return dt <= currentDate && dt.getFullYear() === 2026; // current year
});

const previousYearEvents = sessions.filter((s) => {
  const dt = new Date(d);
  return dt.getFullYear() === 2025 && dt <= currentDate;
});

// 3. Sort events by date [Lines 393-402]
comingSoonEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

// 4. Render date in footer [Lines 574-580]
{
  displayDate && (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <span className="material-symbols-outlined">calendar_month</span>
      <span>
        {new Date(displayDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </span>
    </div>
  );
}
```

**Date Logic:**

- Separate sections for: Upcoming | Current Year Past | Previous Year Past
- Upcoming events sorted ascending (nearest first)
- Past events sorted descending (most recent first)

**Frontend Rendering:** Calendar icon + formatted date (e.g., "Jan 15, 2026") in footer

---

### `location` & `location_coords` Fields

**Rowy Columns:** Text + JSON object
**Firestore Field Names Checked:** `location`, `locationLabel`, `locationCoords`, `coords`,
`coordinates` [Lines 149-156]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Parse coordinates [Lines 17-35]
const parseCoords = (value) => {
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length === 2) return { lat: parts[0], lng: parts[1] };
  }
  if (typeof value === 'object' && value.lat && value.lng) {
    return { lat: Number(value.lat), lng: Number(value.lng) };
  }
  return null;
};

// 2. Reverse geocode coordinates to city name [Lines 38-70]
// If location is "41.8781,-87.6298" → calls Nominatim API → "Chicago, IL"
const label = await reverseGeocode(coords.lat, coords.lng);
if (label) displayLocation = label; // Cache in localStorage

// 3. Get display location [Line 430]
const displayLocation =
  session.location ||
  (session.isManualEntry ? customData.location : customData.location || session.room);

// 4. Render with Google Maps link [Lines 545-568]
{
  displayLocationText ? (
    <>
      <span className="material-symbols-outlined">location_on</span>
      {locationLink ? (
        <a href={locationLink} target="_blank">
          {displayLocationText.includes('°') ? `${displayLocationText} (GPS)` : displayLocationText}
        </a>
      ) : (
        <span>{displayLocationText}</span>
      )}
    </>
  ) : (
    <span>Virtual</span>
  );
}
```

**Geocoding Logic:**

- If coordinates provided → Reverse geocode to city name
- Cache results in localStorage for performance
- US format: "City, State" (e.g., "Chicago, IL")
- International: "City, Country" (e.g., "London, UK")

**Frontend Rendering:** Location icon + clickable city name (links to Google Maps if coordinates,
otherwise plain text)

---

### `eventUrl` Field

**Rowy Column:** URL field
**Firestore Field Names Checked:** `eventUrl` [Line 481]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Check if URL exists [Line 481]
const hasEventUrl =
  customData.eventUrl || (typeof session.eventUrl === 'string' && session.eventUrl);
const eventUrl = customData.eventUrl || session.eventUrl;

// 2. Render globe/language icon [Lines 446-451]
{
  hasEventUrl && (
    <a
      href={eventUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#c2b490] hover:text-slate-900..."
      title="Event page"
    >
      <span className="material-symbols-outlined text-[18px]">language</span>
    </a>
  );
}
```

**Frontend Rendering:** Gold/tan globe icon (clickable) that opens event website in new tab

---

### `presentationUrl` Field

**Rowy Column:** URL field
**Firestore Field Names Checked:** `presentationUrl` [Line 482]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Check if URL exists [Line 482]
const hasPresentation =
  customData.presentationUrl ||
  (typeof session.presentationUrl === 'string' && session.presentationUrl);
const presentationUrl = customData.presentationUrl || session.presentationUrl;

// 2. Render play/media icon [Lines 452-461]
{
  hasPresentation && (
    <a
      href={presentationUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-slate-700 dark:text-slate-300 hover:text-slate-900..."
      title="Presentation"
    >
      <span className="material-symbols-outlined text-[18px]">play_circle</span>
    </a>
  );
}
```

**Frontend Rendering:** Play circle icon (clickable) that opens slides/recording in new tab

---

### `eventImageUrl` Field

**Rowy Column:** Image upload field
**Firestore Field Names Checked:** `eventImageUrl`, `imageUrl`, `eventImageURL` [Lines 488-489]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Get image URL [Lines 488-489]
const imageUrl = customData.eventImageUrl || session.eventImageUrl;

// 2. Display as thumbnail [Lines 495-500]
{
  imageUrl && (
    <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden...">
      <button
        type="button"
        onClick={() => setSelectedImage(imageUrl)} // Click opens modal
        className="w-full h-full p-1..."
      >
        <img
          src={imageUrl}
          alt={displayName}
          className="max-w-full max-h-full object-contain hover:opacity-80..."
        />
      </button>
    </div>
  );
}
```

**Storage Location:** Firebase Cloud Storage
**Path Pattern:**
`gs://hybridcloudworks-61e8d.appspot.com/speakerevents/{docId}/eventImageUrl/{filename.png}`

**Frontend Rendering:**

- 20×20px image thumbnail (right side of card)
- Clickable → Opens modal with full-size image
- Hover effect: Opacity change

---

### `display` Field

**Rowy Column:** Checkbox
**Firestore Field Names Checked:** `display`, `Display` [Line 213]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Filter for display [Line 213]
customEvents = snap.docs
  .map((d) => normalizeEvent({ id: d.id, ...d.data() }))
  .filter((e) => e.display === true);

// Only events with display=true show on page
```

**Frontend Impact:** If `display === false`, event hidden from Speaking Engagements section

---

### `isManualEntry` Field

**Rowy Column:** Checkbox (auto-set)
**Firestore Field Names Checked:** `isManualEntry` [Line 166]

**How It's Used:**

```javascript
// CustomSessionizeWidget.jsx

// 1. Set automatically [Line 166]
isManualEntry: true, // For entries from Rowy (not Sessionize API)

// 2. Source priority [Line 163]
const displayLocation = session.location ||
                        (session.isManualEntry
                          ? customData.location
                          : customData.location || session.room || session.venue);
```

**Purpose:** Tracks whether event came from Sessionize API or manual Rowy entry (informational)

---

---

#### `blogs`

**Firestore Path:** `/blogs/{blogId}`

**Purpose:** Blog posts, articles, technical writing

**Schema:**

```javascript
{
  id: "string",
  title: "string",
  slug: "string",                        // URL-friendly identifier
  content: "string",                     // Markdown or HTML body
  excerpt: "string",                     // Short summary
  author: "string",                      // Author name
  tags: "array<string>",                 // Topic tags
  category: "string",                    // Category (Tech, Career, etc)
  published: "timestamp",                // Publish date
  updated: "timestamp",                  // Last edit date
  featured: "boolean",                   // Show in featured section?
  status: "string",                      // 'draft' | 'published'
  viewCount: "number",                   // Analytics
  display: "boolean"                     // Show in UI?
}
```

**Frontend Usage:** Not currently displayed (infrastructure exists)

**Rowy Configuration:** BlogPost editor with markdown preview

---

#### `episodes`

**Firestore Path:** `/episodes/{episodeId}`

**Purpose:** Podcast or video episodes

**Schema:**

```javascript
{
  id: "string",
  title: "string",
  description: "string",
  episodeNumber: "number",
  season: "number",
  duration: "number",                    // In seconds
  publishedDate: "timestamp",
  videoUrl: "string",                    // YouTube, Vimeo, etc
  audioUrl: "string",                    // Podcast host URL
  transcript: "string",                  // Optional transcript
  display: "boolean"
}
```

**Frontend Usage:** Not currently displayed (infrastructure exists)

---

#### `frameworks`

**Firestore Path:** `/frameworks/{frameworkId}`

**Purpose:** Architecture frameworks, methodologies, assessment tools

**Schema:**

```javascript
{
  id: "string",
  name: "string",                        // Framework name
  description: "string",                 // What it is
  category: "string",                    // Type (Assessment, Architecture, etc)
  pillars: "array<string>",              // Ref to pillar_details docs
  display: "boolean"
}
```

**Related Collections:**

- `pillar_details/{pillarId}` - Individual pillars within a framework
- `pillar_items/{itemId}` - Assessment questions/items within a pillar

---

### 2. CONTENT MANAGEMENT COLLECTIONS (ContentForge Phase 1)

#### `content/pages/{pageId}`

**Firestore Path:** `/content/pages/{pageId}`

**Purpose:** Editable web pages, blog posts, documentation

**Schema:**

```javascript
{
  id: "string",
  title: "string",
  slug: "string",                        // URL path (e.g., /about, /blog/my-post)
  body: "string",                        // Markdown content
  status: "string",                      // 'draft' | 'backlog' | 'published'
  visibility: "string",                  // 'public' | 'private' | 'draft'
  createdBy: "string",                   // User ID
  createdAt: "timestamp",
  updatedAt: "timestamp",
  publishedAt: "timestamp",              // When marked published
  version: "number",                     // Content version
  tags: "array<string>"                  // Content tags
}
```

**Nested Collections:**

- `content/pages/{pageId}/versions` - Version history
- `content/pages/{pageId}/comments` - Discussion/review comments

---

### 3. CONFIGURATION COLLECTIONS

#### `config/providers`

**Firestore Path:** `/config/providers/{providerId}`

**Purpose:** Cloud provider configuration, metadata

**Schema:**

```javascript
{
  id: "string",
  name: "string",                        // "AWS" | "Azure" | "Google Cloud"
  description: "string",
  icon: "string",                        // Icon URL or Material icon name
  url: "string",                         // Provider official website
  active: "boolean"
}
```

---

#### `config/tags`

**Firestore Path:** `/config/tags/{tagId}`

**Purpose:** Tagging system for content categorization

**Schema:**

```javascript
{
  id: "string",
  name: "string",                        // Tag name (e.g., "kubernetes")
  slug: "string",                        // URL slug
  description: "string",
  color: "string",                       // Hex color for UI (#FF5733)
  count: "number"                        // Number of content items using tag
}
```

---

#### `config/settings`

**Firestore Path:** `/config/settings/{settingId}`

**Purpose:** App-wide configuration settings

**Schema:**

```javascript
{
  id: "string",
  key: "string",                         // Setting key (e.g., "site_title")
  value: "string" | "boolean" | "number" // Setting value
  type: "string",                        // 'string' | 'boolean' | 'number' | 'array'
  description: "string",
  public: "boolean"                      // Readable by frontend app?
}
```

---

### 4. AUDIT & SYSTEM COLLECTIONS

#### `audits`

**Firestore Path:** `/audits/{auditId}`

**Purpose:** Change tracking, compliance audit log

**Schema:**

```javascript
{
  id: "string",
  action: "string",                      // 'create' | 'update' | 'delete' | 'publish'
  resourceType: "string",                // 'page' | 'blog' | 'certification'
  resourceId: "string",                  // Doc ID of changed resource
  userId: "string",                      // Who made the change
  changes: "object",                     // { fieldName: { from, to } }
  timestamp: "timestamp",                // When changed
  ipAddress: "string",                   // Optional
  userAgent: "string"                    // Optional
}
```

**Write Only:** Backend service or Cloud Functions

---

#### `system`

**Firestore Path:** `/system/{metadataId}`

**Purpose:** System metadata, counters, statistics

**Schema:**

```javascript
{
  id: "string",
  key: "string",                         // Metadata key
  value: "any",                          // Metadata value
  lastUpdated: "timestamp"
}
```

**Write Only:** Backend/analytics jobs

---

## Frontend-to-Firestore Mapping

### How React Components Read Data

#### Example: Certifications Display

```javascript
// 1. Get all certification documents
const certsSnap = await getDocs(collection(db, 'certifications'));

// 2. Convert docs to objects
const certItems = certsSnap.docs.map(d => ({
  id: d.id,
  ...d.data()
}));

// 3. Filter: only those with display: true
.filter(cert => cert.display === true)

// 4. Normalize: convert issuer codes (AZ-104 → Azure)
.map(cert => {
  if (cert.issuer === 'Microsoft') {
    // Split into Microsoft 365, Azure, other
  }
  return cert;
})

// 5. Sort: by display_order
.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999))

// 6. Display: group by issuer, show badge, links
```

---

## Rowy/BuildShip User Interface & Data Manipulation

### What is Rowy?

**Rowy** is a **Firebase-native spreadsheet UI** that allows non-developers to view, edit, and
manage Firestore collections without touching code or the Firebase Console.

**Important:** Rowy is now closely integrated with BuildShip – same platform, different UI layers.

### How Rowy Works (UI Layer)

```
┌──────────────────────────────────────────┐
│        Rowy Web Interface                │
│   (Spreadsheet-style grid)               │
├──────────────────────────────────────────┤
│ Row | name      | code  | issuer | ...   │
├─────┼───────────┼───────┼────────┤       │
│ 1   | "Azure... | AZ... | Micro. | ...   │
│ 2   | "GCP Ass" | ACE   | Google | ...   │
│ +   | [New Row] |       |        |       │
└────────────┬───────────────────────────────┘
             │ Edit values inline
             │ Click upload button
             │ Add/delete rows
             ▼
┌──────────────────────────────────────────┐
│  Service Account Auth + Firestore SDK    │
│  (Authenticated as: rowy@...iam.gservic) │
└────────────┬───────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│  FIRESTORE: /certifications/...          │
│  - Created docs with new values          │
│  - Updates fields with edited values     │
│  - Deletes documents (if enabled)        │
└──────────────────────────────────────────┘
             │
             │ (Also uploads to)
             ▼
┌──────────────────────────────────────────┐
│  FIREBASE CLOUD STORAGE                  │
│  - gs://bucket/collection/doc-id/field/  │
│  - Handles file uploads from Rowy        │
└──────────────────────────────────────────┘
```

### Rowy Firestore Security Dependencies

Rowy works **only if the Firestore rules allow service account access**.

**Current Rules:** [firestore.rules](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/platform/firebase/firestore.rules#L9-L12)

```firebase-rules
// Helper function to check if request is from a service account
function isServiceAccount() {
  return request.auth.token.firebase.sign_in_provider == 'custom' ||
         request.auth.token.firebase.identities.size() == 0;
}

// Default: Allow service accounts (Rowy), deny everyone else
match /{document=**} {
  allow read, write: if isServiceAccount();
}
```

**Why Needed:** Rowy authenticates using a Firebase service account JSON key (not user login),
allowing it to edit data that regular users can't.

### Accessing Rowy

1. Go to [app.rowy.io](https://app.rowy.io) (or your BuildShip admin panel)
2. Select your Firebase project: `hybridcloudworks-61e8d`
3. Choose a collection: `certifications` or `speakerevents`
4. View all documents as editable spreadsheet rows

### Step-by-Step: Adding a Certification in Rowy

#### Scenario: Add Google Cloud Associate Cloud Engineer cert

1. **Open Rowy** → Select `certifications` collection
2. **Click "+ Add Row"** button
3. **Fill in fields:**

   | Column            | Value                                          | Type                                  |
   | ----------------- | ---------------------------------------------- | ------------------------------------- |
   | `name`            | `Google Cloud Associate Cloud Engineer`        | Text field                            |
   | `code`            | `ACE`                                          | Text field                            |
   | `issuer`          | Select `Google Cloud` from dropdown            | Select field                          |
   | `issueDate`       | Click calendar → Choose June 15, 2024          | Date picker                           |
   | `expiryDate`      | Click calendar → Choose June 15, 2026          | Date picker                           |
   | `credentialImage` | Click upload button → Choose local badge image | Image field (auto-uploads to Storage) |
   | `credentialUrl`   | Paste credential.net link                      | URL field                             |
   | `issuerUrl`       | Paste cloud.google.com link                    | URL field                             |
   | `display`         | Check ✓ checkbox                               | Boolean                               |
   | `display_order`   | Type `2`                                       | Number                                |

4. **Click Save or press Enter**

**What Happens Automatically:**

- ✅ Firestore document created: `/certifications/{auto-generated-id}`
- ✅ Image uploaded to Cloud Storage:
  `gs://...bucket.../certifications/{docId}/credentialImage/badge.png`
- ✅ Full HTTPS download URL saved in `credentialImage` field
- ✅ Real-time listener (if enabled) updates About page instantly
- ✅ Certification appears in grid immediately with blue outline (unsaved indicator)

### Step-by-Step: Adding a Speaking Event in Rowy

#### Scenario: Add KCD Chicago 2026 (manual event)

1. **Open Rowy** → Select `speakerevents` collection
2. **Click "+ Add Row"** button
3. **Fill in fields:**

   | Column            | Value                                                      | Type        |
   | ----------------- | ---------------------------------------------------------- | ----------- |
   | `name`            | `KCD Chicago 2026`                                         | Text field  |
   | `description`     | `Kubernetes Cost Optimization in Multi-Cloud Environments` | Long text   |
   | `date`            | Pick March 15, 2026                                        | Date picker |
   | `location`        | `Chicago, IL`                                              | Text field  |
   | `location_coords` | Leave empty or paste `{"lat": 41.8781, "lng": -87.6298}`   | JSON field  |
   | `eventUrl`        | Paste event website link                                   | URL field   |
   | `presentationUrl` | Leave empty for now                                        | URL field   |
   | `eventImageUrl`   | Upload KCD logo                                            | Image field |
   | `display`         | Check ✓ checkbox                                           | Boolean     |

4. **Click Save**

**What Happens:**

- ✅ Document created in `/speakerevents/{auto-id}`
- ✅ CustomSessionizeWidget will **automatically pick it up** (queries Firestore every time)
- ✅ Shows in "Speaking Engagements" section on About page
- ✅ Appears in grid with date, location icons
- ✅ Image shows as clickable 20×20px thumbnail

**Why It Appears:** Component does `getDocs(collection(db, 'speakerevents'))` → filters
`display === true` → displays on page

### Field Editing in Rowy

**After adding a certification, you can edit any field:**

```
Rowy Interface Updates → Service Account Write → Firestore Document Updated
```

**Example:** Update expiration date

1. Click the `expiryDate` cell
2. Pick new date from calendar
3. Press Enter or Tab
4. **Rowy shows:** Small blue dot on row (unsaved)
5. **Rowy auto-syncs:** Firestore document updated in real-time
6. **Frontend sees:** Real-time listener fires → About page re-renders with new date

### Field Types in Rowy & Storage Mapping

| Firestore Type | Rowy UI Field | Storage                       | Example                       |
| -------------- | ------------- | ----------------------------- | ----------------------------- |
| String         | Text input    | Firestore field               | `"Azure Administrator"`       |
| Timestamp      | Date picker   | Firestore field               | `2024-06-15`                  |
| Boolean        | Checkbox      | Firestore field               | `true` / `false`              |
| URL            | Text field    | Firestore field               | `https://...`                 |
| File/Image     | Upload button | Cloud Storage + Firestore URL | Badge image                   |
| Object         | JSON editor   | Firestore field               | `{"lat": 41.8, "lng": -87.6}` |
| Select         | Dropdown menu | Firestore field               | Option list                   |

---

## Data Validation & Constraints

### Required Fields (Rowy should enforce as required)

**Certifications:**

- `name` - Certification title
- `code` - Exam/cert code
- `issuer` - Issuing organization
- `credentialImage` - Badge image
- `display` - Show/hide toggle

**Speaking Events:**

- `name` - Event name
- `date` - Speaking date
- `location` - City or virtual indicator
- `eventImageUrl` - Event photo

**Pages (ContentForge):**

- `title` - Page title
- `slug` - URL path
- `status` - Publication status

### File Upload Validation

**In Rowy, file upload fields should validate:**

```
- Max size: 10 MB
- Allowed types: image/* (PNG, JPG, WebP)
- Auto-path: /[collection]/[docId]/[fieldName]/
- Auto-URL: Full HTTPS download URL saved to field
```

**Stored in:** Firebase Cloud Storage (`gs://hybridcloudworks-61e8d.appspot.com/`)

**Referenced in:** Firestore document field (as HTTPS URL string)

---

## Real-Time Sync Behavior

### Frontend Listeners (Optional)

If components use real-time listeners instead of one-time reads:

```javascript
// Real-time: Updates whenever Rowy changes the data
const unsubscribe = onSnapshot(collection(db, 'certifications'), (snap) => {
  const certs = snap.docs.map((d) => d.data());
  setCertifications(certs); // UI auto-updates
});
```

**Current Implementation:** One-time read on component mount (not real-time)

**Advantage of Real-Time:** If you edit in Rowy, website updates instantly without refresh

---

## Security Model Summary

| Collection       | Read                  | Write           | Notes                           |
| ---------------- | --------------------- | --------------- | ------------------------------- |
| `certifications` | Public                | Service Account | Anyone views, only Rowy edits   |
| `speakerevents`  | Public                | Service Account | Anyone views, only Rowy edits   |
| `blogs`          | Public                | Service Account | Public reading, Rowy management |
| `content/pages`  | Public (if published) | Service Account | Draft/published separation      |
| `config/*`       | App only              | Service Account | Config not public               |
| `audits`         | Admin only            | Backend         | Change tracking                 |
| `system`         | Backend only          | Backend         | System metadata                 |

---

## Troubleshooting

| Issue                                     | Cause                                 | Fix                                                  |
| ----------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| **Rowy shows "Permission Denied"**        | Service account not in Firebase rules | Add `isServiceAccount()` check to Firestore rules    |
| **Image uploads fail**                    | Cloud Storage path misconfigured      | Verify `storage.rules` allows Rowy service account   |
| **Frontend shows stale data**             | Browser cache                         | Hard refresh (Cmd+Shift+R) or use real-time listener |
| **New cert doesn't appear on About page** | `display: false` set in Rowy          | Set `display: true` in Rowy row                      |
| **Firestore shows doc but not in UI**     | Frontend filter excludes it           | Check `display` flag, `expiryDate` validation        |
| **Duplicate events from Sessionize**      | Manual entry name doesn't match API   | Ensure exact name match (case-insensitive)           |

---

## Rowy/BuildShip User Interface & Data Manipulation

### What is Rowy?

**Rowy** is a **Firebase-native spreadsheet UI** that allows non-developers to view, edit, and
manage Firestore collections without touching code or the Firebase Console.

**Important:** Rowy is now closely integrated with BuildShip – same platform, different UI layers.

### How Rowy Works (UI Layer)

```
┌──────────────────────────────────────────┐
│        Rowy Web Interface                │
│   (Spreadsheet-style grid)               │
├──────────────────────────────────────────┤
│ Row | name      | code  | issuer | ...   │
├─────┼───────────┼───────┼────────┤       │
│ 1   | "Azure... | AZ... | Micro. | ...   │
│ 2   | "GCP Ass" | ACE   | Google | ...   │
│ +   | [New Row] |       |        |       │
└────────────┬───────────────────────────────┘
             │ Edit values inline
             │ Click upload button
             │ Add/delete rows
             ▼
┌──────────────────────────────────────────┐
│  Service Account Auth + Firestore SDK    │
│  (Authenticated as: rowy@...iam.gservic) │
└────────────┬───────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│  FIRESTORE: /certifications/...          │
│  - Created docs with new values          │
│  - Updates fields with edited values     │
│  - Deletes documents (if enabled)        │
└──────────────────────────────────────────┘
             │
             │ (Also uploads to)
             ▼
┌──────────────────────────────────────────┐
│  FIREBASE CLOUD STORAGE                  │
│  - gs://bucket/collection/doc-id/field/  │
│  - Handles file uploads from Rowy        │
└──────────────────────────────────────────┘
```

### Rowy Firestore Security Dependencies

Rowy works **only if the Firestore rules allow service account access**.

**Current Rules:** [firestore.rules](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/platform/firebase/firestore.rules#L9-L12)

```firebase-rules
// Helper function to check if request is from a service account
function isServiceAccount() {
  return request.auth.token.firebase.sign_in_provider == 'custom' ||
         request.auth.token.firebase.identities.size() == 0;
}

// Default: Allow service accounts (Rowy), deny everyone else
match /{document=**} {
  allow read, write: if isServiceAccount();
}
```

**Why Needed:** Rowy authenticates using a Firebase service account JSON key (not user login),
allowing it to edit data that regular users can't.

### Accessing Rowy

1. Go to [app.rowy.io](https://app.rowy.io) (or your BuildShip admin panel)
2. Select your Firebase project: `hybridcloudworks-61e8d`
3. Choose a collection: `certifications` or `speakerevents`
4. View all documents as editable spreadsheet rows

### Step-by-Step: Adding a Certification in Rowy

#### Scenario: Add Google Cloud Associate Cloud Engineer cert

1. **Open Rowy** → Select `certifications` collection
2. **Click "+ Add Row"** button
3. **Fill in fields:**

   | Column            | Value                                          | Type                                  |
   | ----------------- | ---------------------------------------------- | ------------------------------------- |
   | `name`            | `Google Cloud Associate Cloud Engineer`        | Text field                            |
   | `code`            | `ACE`                                          | Text field                            |
   | `issuer`          | Select `Google Cloud` from dropdown            | Select field                          |
   | `issueDate`       | Click calendar → Choose June 15, 2024          | Date picker                           |
   | `expiryDate`      | Click calendar → Choose June 15, 2026          | Date picker                           |
   | `credentialImage` | Click upload button → Choose local badge image | Image field (auto-uploads to Storage) |
   | `credentialUrl`   | Paste credential.net link                      | URL field                             |
   | `issuerUrl`       | Paste cloud.google.com link                    | URL field                             |
   | `display`         | Check ✓ checkbox                               | Boolean                               |
   | `display_order`   | Type `2`                                       | Number                                |

4. **Click Save or press Enter**

**What Happens Automatically:**

- ✅ Firestore document created: `/certifications/{auto-generated-id}`
- ✅ Image uploaded to Cloud Storage:
  `gs://...bucket.../certifications/{docId}/credentialImage/badge.png`
- ✅ Full HTTPS download URL saved in `credentialImage` field
- ✅ Real-time listener (if enabled) updates About page instantly
- ✅ Certification appears in grid immediately with blue outline (unsaved indicator)

### Step-by-Step: Adding a Speaking Event in Rowy

#### Scenario: Add KCD Chicago 2026 (manual event)

1. **Open Rowy** → Select `speakerevents` collection
2. **Click "+ Add Row"** button
3. **Fill in fields:**

   | Column            | Value                                                      | Type        |
   | ----------------- | ---------------------------------------------------------- | ----------- |
   | `name`            | `KCD Chicago 2026`                                         | Text field  |
   | `description`     | `Kubernetes Cost Optimization in Multi-Cloud Environments` | Long text   |
   | `date`            | Pick March 15, 2026                                        | Date picker |
   | `location`        | `Chicago, IL`                                              | Text field  |
   | `location_coords` | Leave empty or paste `{"lat": 41.8781, "lng": -87.6298}`   | JSON field  |
   | `eventUrl`        | Paste event website link                                   | URL field   |
   | `presentationUrl` | Leave empty for now                                        | URL field   |
   | `eventImageUrl`   | Upload KCD logo                                            | Image field |
   | `display`         | Check ✓ checkbox                                           | Boolean     |

4. **Click Save**

**What Happens:**

- ✅ Document created in `/speakerevents/{auto-id}`
- ✅ CustomSessionizeWidget will **automatically pick it up** (queries Firestore every time)
- ✅ Shows in "Speaking Engagements" section on About page
- ✅ Appears in grid with date, location icons
- ✅ Image shows as clickable 20×20px thumbnail

**Why It Appears:** Component does `getDocs(collection(db, 'speakerevents'))` → filters
`display === true` → displays on page

### Field Editing in Rowy

**After adding a certification, you can edit any field:**

```
Rowy Interface Updates → Service Account Write → Firestore Document Updated
```

**Example:** Update expiration date

1. Click the `expiryDate` cell
2. Pick new date from calendar
3. Press Enter or Tab
4. **Rowy shows:** Small blue dot on row (unsaved)
5. **Rowy auto-syncs:** Firestore document updated in real-time
6. **Frontend sees:** Real-time listener fires → About page re-renders with new date

### Field Types in Rowy & Storage Mapping

| Firestore Type | Rowy UI Field | Storage                       | Example                       |
| -------------- | ------------- | ----------------------------- | ----------------------------- |
| String         | Text input    | Firestore field               | `"Azure Administrator"`       |
| Timestamp      | Date picker   | Firestore field               | `2024-06-15`                  |
| Boolean        | Checkbox      | Firestore field               | `true` / `false`              |
| URL            | Text field    | Firestore field               | `https://...`                 |
| File/Image     | Upload button | Cloud Storage + Firestore URL | Badge image                   |
| Object         | JSON editor   | Firestore field               | `{"lat": 41.8, "lng": -87.6}` |
| Select         | Dropdown menu | Firestore field               | Option list                   |

---

## BuildShip Integration: Automated Image Upload Workflow

### Why BuildShip for Image Uploads?

**Problem:** When uploading an image in Rowy, the file goes to Cloud Storage, but Firestore stores a
**file reference object**, not the HTTPS download URL.

**Example of what currently happens:**

```javascript
// In Firestore, credentialImage field contains:
{
  "name": "Azure Administrator Badge.png",
  "size": 45120,
  "type": "image/png",
  "path": "certifications/doc123/credentialImage/badge.png"
  // ❌ NO download URL! Makes Rowy display blank
}
```

**Why this matters:** Rowy's spreadsheet can't display image thumbnails without a full HTTPS URL
pointing to the image.

**Solution:** BuildShip workflow automatically converts file references → full HTTPS download URLs →
stores URL in same field

### BuildShip Workflow: Visual Architecture

```
┌─────────────────────────────────────────────┐
│ User uploads image in Rowy                  │
│ (clicks File field, chooses image)          │
└────────────┬────────────────────────────────┘
             │ File goes to Cloud Storage
             ▼
┌─────────────────────────────────────────────┐
│ FIREBASE CLOUD STORAGE TRIGGER              │
│ Event: onFinalize (file uploaded)           │
│ Path: certifications/{docId}/credentialImage│
└────────────┬────────────────────────────────┘
             │ Triggers BuildShip webhook
             │ POST https://api.buildship.run/...
             ▼
┌─────────────────────────────────────────────┐
│ BUILDSHIP WORKFLOW (3 steps)                │
│ 1. Receive trigger + file metadata          │
│ 2. Get Firebase Admin SDK                   │
│ 3. Generate download URL:                   │
│    bucket.file(path).getSignedUrl({...})    │
│    → Returns: https://storage.googleapis... │
└────────────┬────────────────────────────────┘
             │ Step 4: Update Firestore
             │ Sets field = full download URL
             ▼
┌─────────────────────────────────────────────┐
│ FIRESTORE DOCUMENT UPDATED                  │
│ certifications/{docId} {                    │
│   "credentialImage": "https://storage..."   │
│ }                                           │
└────────────┬────────────────────────────────┘
             │ Real-time listener updates
             ▼
┌─────────────────────────────────────────────┐
│ ROWY PICKS UP CHANGE                        │
│ - Shows image URL in cell                   │
│ - Displays thumbnail preview                │
│ - No need to re-upload                      │
└─────────────────────────────────────────────┘
```

### Setting Up BuildShip Workflow (7 Steps)

#### Step 1: Create BuildShip Account & Project

1. Go to [buildship.run](https://buildship.run)
2. Sign up with Google
3. Create new project for `hybridcloudworks` workspace
4. Connect Firebase project: `hybridcloudworks-61e8d`

#### Step 2: Create Cloud Storage Trigger Node

1. **Add Node** → Search `Firebase Cloud Storage Trigger`
2. **Configure:**
   - Project: `hybridcloudworks-61e8d`
   - Event type: `Object Finalize` (on file upload complete)
   - Bucket: `hybridcloudworks-61e8d.appspot.com`
   - Path pattern: `certifications/{docId}/credentialImage/`
   - Name the node: `"Cert Image Uploaded"`

3. **Output:** This node gives you:
   - `name`: Filename
   - `bucket`: Storage bucket name
   - `generation`: File version ID
   - `metadata`: Custom upload metadata

#### Step 3: Add Firebase Admin SDK Node (Get Download URL)

1. **Add Node** → Search `Firebase Admin SDK`
2. **Configure:**
   - Service Account JSON: Paste your Firebase service account key
   - Initialize Firebase Admin SDK
   - Name: `"Firebase Admin Init"`

3. **Add Second Admin Node** → Method: `Generate Signed URL`
4. **Configure:**
   - Bucket: `hibridcloudworks-61e8d.appspot.com`
   - File path: Use upstream output `${triggers.cert_image_uploaded.name}`
   - Expiration: `7776000000` (90 days, or set to never expire)
   - Action: `read`
   - Name: `"Generate Download URL"`

5. **Output:** Full HTTPS URL like:
   ```
   https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/certifications%2F...?alt=media&token=abc123
   ```

#### Step 4: Add Firestore Update Node

1. **Add Node** → Search `Firestore Update`
2. **Configure:**
   - Collection: `certifications`
   - Document ID: Extract from trigger path using substring/regex
     - Path comes as: `certifications/ABC123XYZ/credentialImage/badge.png`
     - Extract: `ABC123XYZ` (middle part)
     - In BuildShip: Use `${triggers.cert_image_uploaded.name.split('/')[1]}`
   - Field: `credentialImage`
   - Value: Use the signed URL from step 3: `${nodes.firebase_admin.signed_url}`
   - Name: `"Update Cert Document"`

#### Step 5: Deploy & Get Webhook URL

1. Click **Deploy** button
2. Copy the webhook URL displayed:
   ```
   https://api.buildship.run/run/PROJECT_ID/WORKFLOW_ID?key=...
   ```

#### Step 6: Connect Cloud Storage Trigger to Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Navigate to **Cloud Functions** (or **Cloud Storage Triggers**)
3. Create new trigger OR configure existing:
   - Event type: `google.storage.object.finalize`
   - Bucket: `hybridcloudworks-61e8d.appspot.com`
   - Runtime function: Point to BuildShip webhook
   - Add custom: `X-API-Key: [BuildShip API Key]` header

**OR** (Simpler) BuildShip offers **Firebase Trigger** node that auto-connects—use that instead.

#### Step 7: Test the Workflow

1. Open Rowy → `certifications` collection
2. Click any image field or **+ Add Row**
3. Upload a test image file
4. Watch the workflow:
   - Cloud Storage stores file ✓
   - BuildShip trigger fires (check logs)
   - Signed URL generated ✓
   - Firestore field updated with URL ✓
   - Rowy cell shows image thumbnail ✓

**Verify in Rowy:**

- Open `credentialImage` field in Firestore
- Should now contain full HTTPS URL instead of file reference
- Image preview appears in Rowy cell

### BuildShip Workflow for Speaking Events

Same pattern applies to `speakerevents/` images.

**Changes:**

Step 2: Path pattern = `speakerevents/{eventId}/eventImageUrl/` Step 4: Firestore collection =
`speakerevents`, field = `eventImageUrl`

**Webhook URL remains the same** (one workflow handles both collections).

### Troubleshooting BuildShip Workflow

| Issue                                  | Cause                                            | Solution                                                                         |
| -------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Workflow doesn't trigger               | Cloud Storage trigger not connected              | Check Firebase Cloud Functions dashboard; may need to enable Cloud Functions API |
| Signed URL is `null`                   | Service account missing Storage.admin permission | Add role in: IAM & Admin > Service Account > Edit > Grant Storage roles          |
| Path extraction fails                  | Regex/split logic incorrect                      | Log upstream values in BuildShip node; inspect actual file path format           |
| Firestore update fails                 | Document ID incorrect or field name wrong        | Verify collection and field names match exactly (case-sensitive)                 |
| Rowy still shows blank                 | Cached result; URL is there but not refreshed    | Refresh browser; check Firestore console directly for field value                |
| Image URL valid but image doesn't load | Token expired                                    | Set expiration to 7776000000 (90 days) or higher in signed URL step              |

### Rowy File Upload Field Configuration

**For `credentialImage` and `eventImageUrl` fields:**

In Rowy row settings:

```yaml
Field Name: credentialImage
Field Type: Image (or File)
Collection: certifications
BuildShip Workflow: Enable
Auto-generate URL: true # Automatically calls BuildShip after upload
Display as: Thumbnail (20×20px preview)
```

**Result:** When user uploads image, Rowy:

1. Sends to Cloud Storage
2. Triggers BuildShip auto-convert
3. Downloads URL back to Firestore
4. Displays thumbnail in grid

---

## Best Practices

### For Rowy Admins

1. **Set Display Order:** Always set `display_order` (0-9) to control UI ordering
2. **Use Standard Names:** For certifications, use official cert names (Microsoft provides them)
3. **Upload Once:** Don't re-upload images unnecessarily (bandwidth/storage cost)
4. **Verify Links:** Test event/presentation/credential URLs before saving
5. **Keep Dates Current:** Review `expiryDate` fields quarterly

### For Frontend Developers

1. **Always Filter:** Check `display === true` to hide incomplete entries
2. **Handle Missing Data:** Some fields are optional; use fallbacks
3. **Cache Thoughtfully:** Consider real-time listeners for frequently-updated data
4. **Normalize on Read:** Don't assume field formats; validate and normalize in component
5. **Document Fields:** Comment on schemas in code that reference Firestore structure

---

## Future Enhancements

| Enhancement            | Purpose                              | Owner           |
| ---------------------- | ------------------------------------ | --------------- |
| Real-time listeners    | Instant UI updates when Rowy edits   | Frontend dev    |
| Validation triggers    | Cloud Functions enforce data quality | Backend dev     |
| Image optimization     | Auto-generate thumbnails in Storage  | Cloud Functions |
| Analytics tracking     | Count views, clicks per entry        | Analytics dev   |
| Multi-user permissions | Finer-grained Rowy access control    | Admin           |

---

## References

- [Firestore Rules](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/platform/firebase/firestore.rules)
- [Cloud Storage Rules](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/platform/firebase/storage.rules)
- CustomSessionizeWidget *(historical target unavailable)*
- [AboutPage](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx)
- [Rowy Documentation](https://docs.rowy.io/)
- [Firebase Firestore Docs](https://firebase.google.com/docs/firestore)
- [Vendor News Feeds Integration](../archive/integration-vendor-news-feeds.md)

---

## News Pipeline Collections (Added Feb 16, 2026)

### `blogs` Collection — Extended Fields

The existing `blogs` collection has been extended with new fields for the News pipeline:

```javascript
// NEW fields added to existing blogs schema:
{
  source: "string",              // "scrape" | "rss" | "ai-insight" | "manual"
  sourceUrl: "string",           // Original article URL (dedup key)
  sourceFeed: "string",          // RSS feed URL this came from
  category: "string",            // "GA" | "Preview" | "Security" | "AI/ML" | "Compute" etc.
  approvedForNews: "boolean",    // Gate for News page display (default: false)
  approvedForBlog: "boolean",    // Future: gate for personal Blog redistribution
  aiSummary: "string",           // AI-generated summary (via BuildShip)
  aiTags: "array",               // AI-generated tags (via BuildShip)
  readTime: "string",            // Estimated read time ("5 min")
  contentImageUrl: "string",     // Simple URL fallback for cover image
  fetchedAt: "timestamp",        // When the article was scraped/fetched
  expiresAt: "timestamp",        // Optional TTL for news freshness
}
```

**Firestore Indexes:**

- `(Cloud Provider ASC, approvedForNews ASC, Published At DESC)`
- `(Cloud Provider ASC, source ASC, Published At DESC)`

---

### `rss_cache` Collection

**Firestore Path:** `/rss_cache/{provider}_{feedName}`

**Purpose:** Cached RSS feed items for the 25% RSS timeline section. Written by Cloud Functions
only.

```javascript
{
  provider: "string",            // "azure" | "aws" | "gcp" | "github" | "terraform" | "finops"
  feedUrl: "string",             // Source RSS feed URL
  feedName: "string",            // "Azure Blog" | "AWS What's New" etc.
  items: [{                      // Array of parsed feed items (latest 20)
    title: "string",
    link: "string",
    pubDate: "string",
    summary: "string",           // Truncated to ~200 chars
    category: "string",          // Auto-categorized
    author: "string"
  }],
  lastFetched: "timestamp",      // When this cache was last updated
  itemCount: "number"
}
```

**Security Rules:** Public read, write denied (Cloud Functions via Admin SDK only)

**Firestore Indexes:** `(provider ASC, lastFetched DESC)`

---

### `ai_insights` Collection

**Firestore Path:** `/ai_insights/{insightId}`

**Purpose:** AI-generated insight cards and weekly digests for the 25% AI Insights section.

```javascript
{
  provider: "string",            // Provider key
  title: "string",               // Insight title
  insight: "string",             // Markdown content
  insightType: "string",         // "trend" | "tip" | "comparison" | "weekly-digest"
  generatedAt: "timestamp",
  generatedBy: "string",         // agents.md persona code (e.g., "GPCA", "GHE")
  tags: "array",
  active: "boolean"              // Display on news page?
}
```

**Security Rules:** Public read, write denied (BuildShip workflow via service account only)

**Firestore Indexes:** `(provider ASC, active ASC, generatedAt DESC)`
