# INTEGRATION-EXTERNAL-DATASOURCES

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 15, 2026
**Status:** 📔 In Progress - Sessionize Complete
**Purpose:** Reference for external data sources, APIs, and third-party integrations powering the
HCW site

---

## Overview

External data sources provide real-time or regularly-updated content that enriches the site without
requiring manual Firestore updates. This document covers:

- **API connection protocols** (How we connect)
- **Authentication methods** (What credentials are needed)
- **Data schemas** (What gets pulled down)
- **Frontend integration** (Which pages display the data)
- **Rendering logic** (How it's displayed in the UI)
- **Sync strategy** (How often data is updated)
- **Error handling** (What happens if API fails)

### Data Sources Map

| Source                   | Purpose                               | Endpoint                                    | Frontend Page          | Status     |
| ------------------------ | ------------------------------------- | ------------------------------------------- | ---------------------- | ---------- |
| **Sessionize API**       | Speaking engagement events            | https://sessionize.com/api/speaker/json/... | About page             | ✅ Active  |
| **Nominatim API**        | Reverse geocoding for event locations | https://nominatim.openstreetmap.org/reverse | CustomSessionizeWidget | ✅ Active  |
| _More sources coming..._ |                                       |                                             |                        | ⏳ Planned |

---

## Sessionize.com Integration

### What is Sessionize?

**Sessionize** is a speaker/event management platform that tracks conferences, talks, and
presentations. The platform provides:

- **Speaker Profile:** Aggregates all events where you spoke
- **Event Listing:** Conference names, dates, locations, session details
- **Public API:** Read-only REST endpoint to fetch all your events

**URL:** https://sessionize.com/@seanpatino (your public speaker profile)

### Connection Protocol

#### Endpoint Configuration

```
Base URL:    https://sessionize.com/api/speaker/json/
Speaker ID:  c6yicoezls  (Public speaker ID for seanpatino)
Full URL:    https://sessionize.com/api/speaker/json/c6yicoezls
```

**Method:** `GET` (Read-only, no authentication needed)
**Content-Type:** `application/json`
**CORS:** Enabled (browser requests work directly)
**Rate Limit:** None specified (public API)

#### How to Find Your Speaker ID

1. Log into Sessionize: https://sessionize.com/login
2. Go to **Settings** → **Speaker Profile**
3. Copy the ID from your profile URL: `https://sessionize.com/@{speaker-id}`
4. Use this ID in the API endpoint

### Setup Instructions

#### Current Setup (CustomSessionizeWidget)

**File:** src/components/CustomSessionizeWidget.jsx *(historical target unavailable)*

**Lines 187-210 - API Fetch:**

```javascript
// Fetch from Sessionize public API
const sessionizeResponse = await fetch('https://sessionize.com/api/speaker/json/c6yicoezls');

if (!sessionizeResponse.ok) {
  console.error('Sessionize API error:', sessionizeResponse.status);
  setError('Failed to load speaking events');
  return;
}

const allSessionizeEvents = await sessionizeResponse.json();
console.log('Sessionize events loaded:', allSessionizeEvents.length);
```

**Setup Requirements:**

1. ✅ No authentication token needed (public API)
2. ✅ No environment variables required
3. ✅ No CORS issues (enabled by Sessionize)
4. ✅ Read-only access (appropriate for frontend)

**If You Change Speaker:** Update the hardcoded speaker ID `c6yicoezls` to your own speaker ID in
CustomSessionizeWidget.jsx Line 189.

### What Data is Pulled

#### Sessionize API Response Format

**Returns:** Array of event objects

```javascript
[
  {
    id: 'event-123456',
    name: 'KubeCon North America 2025',
    date: '2025-10-14T09:00:00',
    startTime: '09:00',
    endTime: '10:00',
    room: 'Main Hall A',
    roomId: 51849,
    speakers: [
      {
        id: 'speaker-789',
        name: 'Sean Patino',
        profilePictureUrl: 'https://sessionize.com/.../profile.jpg',
        tagLine: 'Cloud Architect',
      },
    ],
    session: {
      id: 'session-456',
      name: 'Kubernetes Cost Optimization in Multi-Cloud Environments',
      description: 'How to optimize Kubernetes spend across AWS, Azure, and GCP...',
      startsAt: '2025-10-14T09:00:00',
      endsAt: '2025-10-14T10:00:00',
    },
  },
  // ... more events
];
```

#### Data Extraction in CustomSessionizeWidget

**Lines 228-245 - Field Mapping:**

```javascript
// Normalize Sessionize event to canonical schema
const normalizeEvent = (raw) => ({
  id: raw.id,
  name: raw.session?.name || raw.name || 'Untitled',
  description: raw.session?.description || '',
  date: raw.session?.startsAt || raw.date || raw.startsAt,
  time: raw.startTime,
  location: raw.room || raw.location || 'Virtual',
  eventUrl: raw.eventUrl,
  presentationUrl: raw.presentationUrl || '',
  imageUrl: raw.imageUrl || raw.speakers?.[0]?.profilePictureUrl,
  speakerId: raw.speakers?.[0]?.id,
  isManualEntry: false, // Flag: comes from API, not Rowy
});
```

#### Fields Extracted to Site

| Field         | Source                            | Frontend Use                                          |
| ------------- | --------------------------------- | ----------------------------------------------------- |
| `name`        | `session.name` or `name`          | Event title in UI                                     |
| `description` | `session.description`             | Event description (expandable)                        |
| `date`        | `session.startsAt`                | Event date/time displayed                             |
| `location`    | `room`                            | Event location (city extracted via reverse geocoding) |
| `speakers`    | `speakers[0]`                     | Speaker profile info (used for fallback image)        |
| `eventUrl`    | `eventUrl` field                  | Link to event website (globe icon)                    |
| `imageUrl`    | Sessionize image or speaker photo | Event thumbnail in grid                               |

### Data Merge Strategy: Sessionize + Firestore

The site combines data from **two sources** to create a complete speaking engagement list:

```
┌─────────────────────────────────────────────────────────────────┐
│ SPEAKING ENGAGEMENTS = Sessionize API + Firestore Manual        │
└─────────────────────────────────────────────────────────────────┘

1. Fetch Sessionize API
   └─> Returns: [KubeCon, AWS Summit, GCP Next, Kubeflow World, ...]

2. Fetch Firestore /speakerevents collection
   └─> Returns: [KubeCon (with manual override), Local Meetup (manual), ...]

3. CREATE MERGE MAP by event name
   └─> Name matching (case-insensitive, trimmed)
   └─> Allows Firestore to override/enhance Sessionize data

4. MERGE STRATEGY:
   ┌─ If event exists in BOTH:
   │  └─> Use Firestore version (overrides Sessionize)
   │     ├─ Keeps custom descriptions from Rowy
   │     ├─ Uses custom images from Cloud Storage
   │     ├─ Applies manual location overrides
   │     └─ Marks as "manual override"
   │
   ├─ If event exists in SESSIONIZE only:
   │  └─> Use Sessionize version as-is
   │     └─ Auto-loads from API
   │
   └─ If event exists in FIRESTORE only:
      └─> Include as standalone event
         └─ Displays as "Manual Entry" (not from Sessionize)

5. RESULT: Combined list of all events with Firestore overrides
```

**Merge Implementation (Lines 228-240):**

```javascript
// Create map for fast lookup by name
const customEventsMap = new Map(customEvents.map((e) => [(e.name || '').trim().toLowerCase(), e]));

// Apply Firestore overrides to Sessionize events
const combinedEvents = allSessionizeEvents.map((sessionizeEvent) => {
  const eventName = (sessionizeEvent.session?.name || sessionizeEvent.name || '')
    .trim()
    .toLowerCase();

  // Check for exact match in Firestore
  let customData = customEventsMap.get(eventName);

  // Also check if event ends with " (copy)" - handle Rowy duplicates
  if (!customData && eventName.endsWith(' (copy)')) {
    const correctedName = eventName.replace(' (copy)', '').trim();
    customData = customEventsMap.get(correctedName);
  }

  if (customData) {
    customEventsMap.delete(eventName); // Mark as merged
    // Merge: Firestore data overrides Sessionize
    return { ...sessionizeEvent, ...customData };
  }

  return sessionizeEvent; // Use Sessionize as-is
});

// Add unmatched Firestore entries (manual-only events)
const manualEntries = Array.from(customEventsMap.values());
const allEvents = [...combinedEvents, ...manualEntries];
```

**Result:** `allEvents` now contains:

- ✅ Sessionize events + Firestore overrides
- ✅ Firestore-only manual entries
- ✅ Merged data with Firestore taking precedence (display, custom images, descriptions)

### Pages Using Sessionize Data

#### About Page (`/src/pages/shared/AboutPage.jsx`)

**Section:** "Speaking Engagements"

**Component:** CustomSessionizeWidget (Lines 1-662)

**Usage Pattern:**

```javascript
// AboutPage.jsx
import CustomSessionizeWidget from '@/components/CustomSessionizeWidget';

export default function AboutPage() {
  return (
    <section>
      <h2>Speaking Engagements</h2>
      <p>Conference talks, panel discussions, and technical presentations</p>
      <CustomSessionizeWidget /> {/* Fetches + displays Sessionize data */}
    </section>
  );
}
```

**Component Responsibility:**

1. Fetch Sessionize API
2. Fetch Firestore speakerevents
3. Merge the two sources
4. Categorize by date (Upcoming | Current Year Past | Previous Year Past)
5. Render event cards with images, descriptions, links, location

### How Data is Displayed

#### CustomSessionizeWidget Rendering

**File:** src/components/CustomSessionizeWidget.jsx *(historical target unavailable)*
(Lines 356-600)

#### Calendar View: Date Categorization

**Lines 365-402 - Event Sorting:**

```javascript
const currentDate = new Date();
const currentYear = currentDate.getFullYear();

// 1. Upcoming events (in the future)
const comingSoonEvents = sessions.filter((s) => new Date(s.date || s.startsAt) > currentDate);

// 2. Past events from current year
const currentYearPastEvents = sessions.filter((s) => {
  const dt = new Date(s.date || s.startsAt);
  return dt <= currentDate && dt.getFullYear() === currentYear;
});

// 3. Past events from previous year
const previousYearEvents = sessions.filter((s) => {
  const dt = new Date(s.date || s.startsAt);
  return dt.getFullYear() === currentYear - 1 && dt <= currentDate;
});

// Sort each group by date (ascending = nearest first for upcoming)
comingSoonEvents.sort((a, b) => new Date(a.date || a.startsAt) - new Date(b.date || b.startsAt));
currentYearPastEvents.sort(
  (a, b) => new Date(a.date || a.startsAt) - new Date(b.date || b.startsAt)
);
previousYearEvents.sort((a, b) => new Date(a.date || a.startsAt) - new Date(b.date || b.startsAt));
```

#### Event Card Rendering

**Lines 437-600 - UI Components:**

```javascript
// Each event renders as a card:
const renderSession = (session) => {
  const displayName = session.name;
  const description = session.description || '';
  const imageUrl = session.imageUrl;
  const hasEventUrl = session.eventUrl;
  const displayDate = session.date || session.startsAt;
  const displayLocation = session.location || 'Virtual';
  const isExpanded = expandedSessions.includes(session.id);

  return (
    <div key={session.id} className="event-card">
      {/* Event Title */}
      <h4>{displayName}</h4>

      {/* Action Icons */}
      <div className="action-icons">
        {/* Website link (globe icon) */}
        {hasEventUrl && (
          <a href={session.eventUrl} target="_blank">
            <span className="material-symbols-outlined">language</span>
          </a>
        )}

        {/* Presentation/slides link (play icon) */}
        {session.presentationUrl && (
          <a href={session.presentationUrl} target="_blank">
            <span className="material-symbols-outlined">play_circle</span>
          </a>
        )}
      </div>

      {/* Event Image (clickable thumbnail) */}
      {imageUrl && (
        <button onClick={() => setSelectedImage(imageUrl)}>
          <img src={imageUrl} alt={displayName} className="w-5 h-5" />
        </button>
      )}

      {/* Description (expandable) */}
      <p className={isExpanded ? '' : 'line-clamp-4'}>{description}</p>
      {description.length > 200 && (
        <button onClick={() => toggleexpanded(session.id)}>
          {isExpanded ? 'Show Less' : 'Show More'}
        </button>
      )}

      {/* Location with Map Link */}
      <div className="meta-info">
        <span className="material-symbols-outlined">location_on</span>
        {locationLink ? (
          <a href={locationLink} target="_blank">
            {displayLocation}
            {hasCoordinates && ' (GPS)'}
          </a>
        ) : (
          <span>{displayLocation}</span>
        )}
      </div>

      {/* Date */}
      <div className="meta-info">
        <span className="material-symbols-outlined">calendar_month</span>
        <span>
          {new Date(displayDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
    </div>
  );
};
```

#### CSS Classes & Styling

| Element        | CSS Class                                   | Effect                               |
| -------------- | ------------------------------------------- | ------------------------------------ |
| Card container | `flex flex-col gap-2 p-4 rounded-lg border` | Stacked layout, spacing              |
| Event title    | `h4`                                        | Large font, bold                     |
| Action icons   | `flex gap-2 text-[#c2b490]`                 | Gold/tan color, clickable            |
| Location link  | `hover:text-slate-900`                      | Changes color on hover               |
| Description    | `line-clamp-4`                              | Truncates to 4 lines unless expanded |
| Meta info      | `flex items-center gap-1 text-sm`           | Icon + text on same line             |

### Location Geocoding: Nominatim API

Speaking event locations are enhanced with **reverse geocoding** to extract city names from
coordinates.

**API:** [Nominatim (OpenStreetMap)](https://nominatim.org/)

#### Reverse Geocoding Flow

**Lines 38-70 - reverseGeocode Function:**

```javascript
const reverseGeocode = async (lat, lng) => {
  // Validate coordinate range
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    console.warn('Invalid coordinates:', lat, lng);
    return null;
  }

  // Check localStorage cache first (avoid repeated API calls)
  const cacheKey = `geocode:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    // Call Nominatim reverse geocoding API
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`
    );

    const data = await response.json();

    // Extract city and country from response
    const city = data.address?.city || data.address?.town || '';
    const state = data.address?.state || '';
    const country = data.address?.country || 'Unknown';

    // Format label: US = "City, State"; International = "City, Country"
    const label = country === 'United States' ? `${city}, ${state}` : `${city}, ${country}`;

    // Cache result for 30 days
    localStorage.setItem(cacheKey, JSON.stringify(label));
    return label;
  } catch (err) {
    console.error('Geocoding failed:', err);
    return null;
  }
};
```

#### How It's Used

**Lines 365-390 - Location Resolution:**

```javascript
// If event has coordinates, reverse geocode to city name
const resolveLocations = async (events) => {
  return Promise.all(
    events.map(async (event) => {
      if (event.location_coords) {
        const coords = parseCoords(event.location_coords);
        if (coords) {
          const geocodedLocation = await reverseGeocode(coords.lat, coords.lng);
          return {
            ...event,
            displayLocation: geocodedLocation || event.location,
            locationLink: `https://google.com/maps?q=${coords.lat},${coords.lng}`,
          };
        }
      }
      return event;
    })
  );
};
```

**Result:**

- Coordinates `{"lat": 41.8781, "lng": -87.6298}` → "Chicago, IL"
- Location displayed + clickable Google Maps link

### Data Sync Frequency

| Component               | Sync Frequency      | Method                   | Cache                       |
| ----------------------- | ------------------- | ------------------------ | --------------------------- |
| Sessionize API          | **On page load**    | Fetch (GET)              | Browser (not cached)        |
| Firestore speakerevents | **On page load**    | getDocs() (Firebase SDK) | Firebase real-time listener |
| Nominatim geocoding     | **Per coordinates** | Fetch (GET)              | localStorage (30 days)      |

**Current Behavior:**

- About page loads → CustomSessionizeWidget mounts
- useEffect runs → Fetches both Sessionize + Firestore
- Components render once both sources loaded
- **No polling** (doesn't auto-refresh) — requires page reload to see new data

### Error Handling

#### Sessionize API Failures

**Lines 207-218:**

```javascript
if (!sessionizeResponse.ok) {
  console.error('Sessionize API error:', sessionizeResponse.status);
  setError('Failed to load speaking events');
  setLoading(false);
  return;
}
```

**Fallback:** If API fails, component shows error message and uses Firestore data only.

#### Network Timeouts

**Default timeout:** Browser default (typically 30-60 seconds)

**Recommendation:** Add AbortController for custom timeout:

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

const response = await fetch(sessionizeAPI, { signal: controller.signal });
clearTimeout(timeoutId);
```

#### Geocoding Failures

If Nominatim API fails or coordinates invalid:

- Fallback to raw location text from event
- Skip Google Maps link
- Log error but don't break rendering

### Troubleshooting

| Issue                              | Cause                                            | Solution                                                                       |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| **No events showing**              | Sessionize API down or speaker ID wrong          | Check Sessionize status; verify speaker ID `c6yicoezls` is correct             |
| **Some events missing**            | Firestore events not merging                     | Check event name exact match (case-insensitive); check `display: true` in Rowy |
| **Locations showing as "Virtual"** | No coordinates or geocoding failed               | Add `location_coords` to Firestore; check Nominatim API availability           |
| **Images not loading**             | Cloud Storage URL expired                        | Re-upload image in Rowy; BuildShip workflow will generate fresh URL            |
| **Description being cut off**      | Long text exceeds `line-clamp-4`                 | User can click "Show More" to expand                                           |
| **Duplicate events**               | Firestore entry name exact match with Sessionize | Rename in Rowy to avoid match, or delete duplicate                             |
| **Page slow to load**              | Nominatim API slow                               | Results cached; after first load, subsequent loads are fast                    |

---

## External Data Sources: Future Additions

_Placeholder for additional external data sources (coming soon)_

- Twitter/X API (announcements, profile updates)
- GitHub API (repository statistics, activity)
- Medium API (blog syndication)
- YouTube API (video/channel data)
- LinkedIn API (profile updates)

---

## References

- **Sessionize API Docs:** https://sessionize.com/api/
- **Nominatim API Docs:** https://nominatim.org/release-docs/latest/api/
- **CustomSessionizeWidget Code:**
  src/components/CustomSessionizeWidget.jsx *(historical target unavailable)*
- **About Page Code:** [src/pages/shared/AboutPage.jsx](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx)
- **Firestore Collections:**
  [database-firestore-collections.md](../archive/database-firestore-collections.md)
