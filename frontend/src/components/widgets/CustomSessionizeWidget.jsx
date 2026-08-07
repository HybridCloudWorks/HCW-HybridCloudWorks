/* eslint-disable complexity */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadPublicDataSnapshot } from '@/lib/publicData';
import { fetchPublicSnapshotItems } from '@/lib/publicApi';

/**
 * CustomSessionizeWidget: Displays speaking engagements from Sessionize API + Firestore
 *
 * LOCATION DISPLAY FORMAT STANDARD:
 * ================================
 * All speaking engagements display locations as:
 * - For US cities: "City, State" (e.g., "Chicago, IL", "New York, NY")
 * - For non-US cities: "City, Country" (e.g., "Toronto, Canada", "London, United Kingdom")
 * - Virtual events: "Virtual"
 * - GPS coordinates: "lat, lng (GPS)"
 *
 * This is enforced through three mechanisms:
 * 1. formatLocationFromAddress(): Extracts city/state/country from Nominatim API address
 * 2. reverseGeocode(): Gets "City, State/Country" from coordinates (cached)
 * 3. forwardGeocode(): Converts location strings to coordinates for full geocoding
 *
 * Workflow:
 * - Event with coordinates → reverseGeocode() → "City, State" or "City, Country"
 * - Event with location string → forwardGeocode() → reverseGeocode() → "City, State" or "City, Country"
 * - Virtual indicator → Show "Virtual"
 * - No location data → Show "Virtual"
 */
const CustomSessionizeWidget = ({ speakerId = 'c6yicoezls' }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);
  const modalRef = useRef();
  const containerRef = useRef();
  const [isInView, setIsInView] = useState(false);

  const parseCoords = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      const parts = value.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
        return { lat: parts[0], lng: parts[1] };
      }
      return null;
    }
    if (typeof value === 'object') {
      if (value.lat !== undefined && value.lng !== undefined) {
        return { lat: Number(value.lat), lng: Number(value.lng) };
      }
      if (value.latitude !== undefined && value.longitude !== undefined) {
        return { lat: Number(value.latitude), lng: Number(value.longitude) };
      }
      if (value._lat !== undefined && value._long !== undefined) {
        return { lat: Number(value._lat), lng: Number(value._long) };
      }
    }
    return null;
  };

  const formatLocationFromAddress = (address) => {
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.hamlet ||
      address.municipality ||
      address.suburb ||
      address.neighbourhood ||
      address.county ||
      '';
    const state = address.state || address.region || '';
    const country = address.country || '';

    // Format as City, State for US; City, Country for others
    let label = '';
    if (country === 'United States') {
      label = state && city ? `${city}, ${state}` : city || country;
    } else {
      label = city && country ? `${city}, ${country}` : city || country;
    }
    return label;
  };

  const normalizeLocationLabel = (label) => {
    if (!label || typeof label !== 'string') return label;
    const trimmed = label.trim();
    if (!trimmed || /^(virtual)$/i.test(trimmed)) return trimmed;
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

    const parts = trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) return trimmed;

    const last = parts.at(-1);
    const isUnitedStates =
      /^(united states|united states of america|usa|us|u\.s\.|u\.s\.a\.)$/i.test(last);

    if (isUnitedStates) {
      // "City, State, United States" → "City, State"
      // parts[0] = city, parts[1] = state (if present), last = "United States"
      const [city, stateCandidate = ''] = parts;
      const state = parts.length >= 3 ? stateCandidate : '';
      return state ? `${city}, ${state}` : city;
    }

    // Non-US: "City, Country" (skip intermediate parts like region/province)
    const [city] = parts;
    return `${city}, ${last}`;
  };

  const parseDateValue = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Accept either a bare YYYY-MM-DD or a full ISO timestamp; anchor at
      // local noon so display dates do not drift across timezones.
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return new Date(Number(year), Number(month) - 1, Number(day), 12);
      }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDateTimestamp = (value) => {
    const date = parseDateValue(value);
    return date ? date.getTime() : 0;
  };

  const formatDateLabel = (value) => {
    const date = parseDateValue(value);
    if (!date) return '';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return null;
      }
      const cacheKey = `geocode:${lat.toFixed(4)},${lng.toFixed(4)}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) return cached;
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
        { headers: { Accept: 'application/json' } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const a = data.address || {};
      const label = formatLocationFromAddress(a);

      if (label) localStorage.setItem(cacheKey, label);
      return label || null;
    } catch {
      return null;
    }
  }, []);

  // Forward geocoding: convert location name/string to coordinates
  const forwardGeocode = useCallback(async (locationString) => {
    try {
      if (!locationString || typeof locationString !== 'string') return null;
      const cacheKey = `forward-geocode:${locationString}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed;
      }
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationString)}&format=json&countrycodes=us&limit=1&addressdetails=1`,
        { headers: { Accept: 'application/json' } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) {
        // Try without countrycodes restriction for international locations
        const respInt = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationString)}&format=json&limit=1&addressdetails=1`,
          { headers: { Accept: 'application/json' } }
        );
        if (!respInt.ok) return null;
        const dataInt = await respInt.json();
        if (!Array.isArray(dataInt) || dataInt.length === 0) return null;
        const [firstResult] = dataInt;
        const result = {
          lat: parseFloat(firstResult.lat),
          lng: parseFloat(firstResult.lon),
          address: firstResult.address || {},
        };
        if (result.lat && result.lng) localStorage.setItem(cacheKey, JSON.stringify(result));
        return result;
      }
      const [firstResult] = data;
      const result = {
        lat: parseFloat(firstResult.lat),
        lng: parseFloat(firstResult.lon),
        address: firstResult.address || {},
      };
      if (result.lat && result.lng) localStorage.setItem(cacheKey, JSON.stringify(result));
      return result;
    } catch (err) {
      console.error('Forward geocoding error:', err);
      return null;
    }
  }, []);

  const resolveLocations = useCallback(
    async (events) => {
      const out = [];
      for (const ev of events) {
        let displayLocation = ev.location;
        let coords = null;
        if (typeof ev.location === 'string') {
          coords = parseCoords(ev.location);
        }
        if (!coords && ev.location_coords) {
          coords = parseCoords(ev.location_coords);
        }
        if (!coords && typeof ev.location === 'object') {
          coords = parseCoords(ev.location);
        }
        const needsGeocode =
          !displayLocation || /^(virtual)$/i.test(String(displayLocation)) || Boolean(coords);
        if (needsGeocode && coords) {
          const label = await reverseGeocode(coords.lat, coords.lng);
          if (label) {
            displayLocation = label;
          } else {
            displayLocation = `${coords.lat}, ${coords.lng}`;
          }
        } else if (
          !coords &&
          displayLocation &&
          typeof displayLocation === 'string' &&
          !/^(virtual)$/i.test(displayLocation)
        ) {
          // Try forward geocoding for location strings without coordinates
          const geocodeResult = await forwardGeocode(displayLocation);
          if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
            const label = await reverseGeocode(geocodeResult.lat, geocodeResult.lng);
            if (label) {
              displayLocation = label;
            } else if (geocodeResult.address) {
              displayLocation = formatLocationFromAddress(geocodeResult.address);
            }
          }
        }
        out.push({ ...ev, location: displayLocation });
      }
      return out;
    },
    [forwardGeocode, reverseGeocode]
  );

  const normalizeEvent = (raw) => {
    const get = (obj, candidates) => {
      for (const k of candidates) {
        if (obj[k] !== undefined) return obj[k];
      }
      return undefined;
    };

    const normalizeKey = (key) => {
      if (!key || typeof key !== 'string') return key;
      // camelCase to camelCase passthrough
      return key.charAt(0).toLowerCase() + key.slice(1);
    };

    const normalizeObjectKeys = (obj) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
      const normalized = {};
      for (const [key, value] of Object.entries(obj)) {
        normalized[normalizeKey(key)] = value;
      }
      return normalized;
    };

    const normalizedRaw = normalizeObjectKeys(raw);

    const toDateVal = (v) => {
      if (!v) return undefined;
      if (typeof v?.toDate === 'function') return v.toDate().toISOString();
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'number') return new Date(v).toISOString();
      if (typeof v === 'string') {
        const s = v.trim();
        const ymd = s.length >= 10 ? s.slice(0, 10) : s;
        const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!ymdRegex.test(ymd)) return s;
        return ymd;
      }
      return undefined;
    };

    const loc = get(normalizedRaw, ['location', 'locationLabel']);
    const coords = get(normalizedRaw, ['locationCoords', 'coords', 'coordinates']);
    // Primary: Firebase Storage image (populated by Cloud Function from eventImageUrl)
    const imagesRaw = get(normalizedRaw, ['images', 'Images']);
    const storedImage = Array.isArray(imagesRaw)
      ? imagesRaw[0]?.downloadURL
      : imagesRaw?.downloadURL || (typeof imagesRaw === 'string' ? imagesRaw : null);

    // Fallback: raw external URL in eventImageUrl field
    const imageRaw = get(normalizedRaw, ['eventImageUrl', 'imageUrl', 'eventImageURL']);
    const externalImageUrl = Array.isArray(imageRaw)
      ? imageRaw[0]?.downloadURL
      : imageRaw?.downloadURL || imageRaw;

    const displayVal = get(normalizedRaw, ['display', 'Display']);
    const sessionizeId = get(normalizedRaw, [
      'eventId',
      'sessionizeId',
      'SessionizeId',
      'sessionize_id',
    ]);

    return {
      id: normalizedRaw.id || raw.id,
      sessionizeId: sessionizeId ? Number(sessionizeId) : null,
      name: (get(normalizedRaw, ['eventName', 'name', 'Name']) || '').trim(),
      description: get(normalizedRaw, ['description', 'Description']),
      date: toDateVal(get(normalizedRaw, ['date', 'Date'])),
      location: loc,
      location_coords: coords,
      eventUrl: get(normalizedRaw, ['eventUrl']),
      presentationUrl: get(normalizedRaw, ['presentationUrl']),
      image: storedImage || null,
      eventImageUrl: externalImageUrl || null,
      isManualEntry: true,
      display: displayVal === true,
    };
  };

  useEffect(() => {
    if (!isInView) return; // Don't fetch until widget is near the viewport
    const fetchData = async () => {
      try {
        if (!/^[a-zA-Z0-9]+$/.test(speakerId)) {
          throw new Error('Invalid speaker ID');
        }

        const sessionizeResponse = await fetch(
          `https://sessionize.com/api/speaker/json/${speakerId}`
        );
        if (!sessionizeResponse.ok) {
          throw new Error(`HTTP error! status: ${sessionizeResponse.status}`);
        }
        const sessionizeData = await sessionizeResponse.json();
        const allSessionizeEvents = sessionizeData.events || sessionizeData.sessions || [];

        // Static JSON is the fast public path. The snapshots API is only a
        // quiet fallback for deploys that do not have the generated file yet.
        let rawCustomEvents = await loadPublicDataSnapshot('/data/speakerevents.json');

        if (rawCustomEvents.length === 0) {
          try {
            rawCustomEvents = await fetchPublicSnapshotItems('speakerevents');
          } catch {
            rawCustomEvents = [];
          }
        }

        const allCustomEvents = rawCustomEvents
          .filter((item) => item && typeof item === 'object')
          .map((d) => normalizeEvent(d));

        // Two lookup maps: by Sessionize numeric ID (preferred) and by lowercased name (fallback)
        const bySessionizeId = new Map(
          allCustomEvents.filter((e) => e.sessionizeId).map((e) => [e.sessionizeId, e])
        );
        const byName = new Map(
          allCustomEvents.map((e) => [(e.name || '').trim().toLowerCase(), e])
        );

        // Track which Firestore docs were matched so we know what's left for manual entries
        const matchedFirestoreIds = new Set();

        const mergeWithFirestore = (sessionizeEvent, firestoreDoc) => {
          // Firestore wins on any field it actually has set; Sessionize fills the rest
          const startsAt = sessionizeEvent.startsAt || sessionizeEvent.eventStartDate || null;
          const sessionizeEventUrl = sessionizeEvent.eventUrl || sessionizeEvent.website || null;
          return {
            id: sessionizeEvent.id || firestoreDoc.id,
            name: firestoreDoc.name || (sessionizeEvent.name || sessionizeEvent.title || '').trim(),
            startsAt,
            date: firestoreDoc.date || startsAt,
            location: firestoreDoc.location || sessionizeEvent.location || null,
            location_coords: firestoreDoc.location_coords || null,
            description: firestoreDoc.description || sessionizeEvent.description || null,
            eventUrl: firestoreDoc.eventUrl || sessionizeEventUrl,
            presentationUrl: firestoreDoc.presentationUrl || null,
            image: firestoreDoc.image || null,
            eventImageUrl: firestoreDoc.eventImageUrl || null,
            isManualEntry: false,
          };
        };

        const combinedEvents = allSessionizeEvents.map((sessionizeEvent) => {
          const sessionizeNumericId = sessionizeEvent.id ? Number(sessionizeEvent.id) : null;
          const eventName = (sessionizeEvent.name || sessionizeEvent.title || '').trim();
          const normalizedName = eventName.toLowerCase();
          const startsAt = sessionizeEvent.startsAt || sessionizeEvent.eventStartDate || null;
          const sessionizeEventUrl = sessionizeEvent.eventUrl || sessionizeEvent.website || null;

          // 1. Match by Sessionize ID (most reliable)
          let firestoreDoc = sessionizeNumericId ? bySessionizeId.get(sessionizeNumericId) : null;

          // 2. Fall back to name match (case-insensitive)
          if (!firestoreDoc) {
            firestoreDoc = byName.get(normalizedName);
            // Also try without trailing year suffix variants like " (copy)"
            if (!firestoreDoc && normalizedName.endsWith(' (copy)')) {
              firestoreDoc = byName.get(normalizedName.replace(' (copy)', '').trim());
            }
          }

          if (firestoreDoc) {
            matchedFirestoreIds.add(firestoreDoc.id);
            return mergeWithFirestore(sessionizeEvent, firestoreDoc);
          }

          // No Firestore doc — use Sessionize data as-is
          return {
            ...sessionizeEvent,
            startsAt,
            eventUrl: sessionizeEventUrl,
            name: eventName,
          };
        });

        // Unmatched Firestore docs with display:true become standalone manual entries
        const manualEntries = allCustomEvents
          .filter((e) => !matchedFirestoreIds.has(e.id) && e.display === true)
          .map((entry) => ({ ...entry, isManualEntry: true }));

        const allEvents = [...combinedEvents, ...manualEntries];

        allEvents.sort((a, b) => {
          const dateA = getDateTimestamp(a.date || a.startsAt);
          const dateB = getDateTimestamp(b.date || b.startsAt);
          if (!dateA && !dateB) return 1;
          if (!dateA) return 1;
          if (!dateB) return -1;
          const isComingSoon = dateA > Date.now() || dateB > Date.now();
          if (isComingSoon) {
            return dateA - dateB;
          }
          return dateB - dateA;
        });

        const withResolvedLocations = await resolveLocations(allEvents);
        setSessions(withResolvedLocations);
      } catch (err) {
        setError('Failed to load sessions');
        console.error('API error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [speakerId, resolveLocations, isInView]);

  // IntersectionObserver: start fetching data when the widget is 300px from the viewport.
  // Fires once, then disconnects — no overhead after initial load.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedImage(null);
    };
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setSelectedImage(null);
      }
    };

    if (selectedImage) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedImage]);

  const getLocationLink = (location) => {
    if (!location) return null;
    if (typeof location === 'string') {
      if (location.toLowerCase().includes('virtual')) return null;
      return `https://www.google.com/maps/search/${encodeURIComponent(location)}`;
    }
    if (typeof location === 'object') {
      const c = parseCoords(location);
      if (c) return `https://www.google.com/maps/search/${encodeURIComponent(`${c.lat},${c.lng}`)}`;
    }
    return null;
  };

  const getDisplayName = (name) => name || 'Event Title';

  const currentDate = new Date();

  const comingSoonEvents = sessions.filter((s) => {
    const d = parseDateValue(s.date || s.startsAt);
    if (!d) return false;
    return d > currentDate;
  });

  const currentYear = currentDate.getFullYear();

  const currentYearPastEvents = sessions.filter((s) => {
    const dt = parseDateValue(s.date || s.startsAt);
    if (!dt) return false;
    return dt <= currentDate && dt.getFullYear() === currentYear;
  });

  const previousYearEvents = sessions.filter((s) => {
    const dt = parseDateValue(s.date || s.startsAt);
    if (!dt) return false;
    return dt.getFullYear() === currentYear - 1 && dt <= currentDate;
  });

  comingSoonEvents.sort(
    (a, b) => getDateTimestamp(a.date || a.startsAt) - getDateTimestamp(b.date || b.startsAt)
  );
  currentYearPastEvents.sort(
    (a, b) => getDateTimestamp(a.date || a.startsAt) - getDateTimestamp(b.date || b.startsAt)
  );
  previousYearEvents.sort(
    (a, b) => getDateTimestamp(a.date || a.startsAt) - getDateTimestamp(b.date || b.startsAt)
  );
  const renderSession = (session, index) => {
    // All fields are already merged in fetchData — use session directly.
    const sessionKey = session.id || `${session.name || 'session'}-${index}`;
    const displayDate = session.date || session.startsAt;
    let displayLocationText = session.location;
    if (displayLocationText && typeof displayLocationText !== 'string') {
      const c = parseCoords(displayLocationText);
      if (c) displayLocationText = `${c.lat}, ${c.lng}`;
    }
    if (typeof displayLocationText === 'string') {
      displayLocationText = normalizeLocationLabel(displayLocationText);
    }
    const locationLink = getLocationLink(displayLocationText);
    const description = session.description || 'Event description not available';
    const isExpanded = expandedCard === sessionKey;
    const displayName = getDisplayName(session.name || session.title);
    // Primary image: Firebase Storage; fallback: external URL
    const imageUrl = session.image || session.eventImageUrl;
    const imageFallback = session.eventImageUrl || null;
    const { presentationUrl } = session;
    const hasPresentation = Boolean(presentationUrl);
    const { eventUrl } = session;
    const hasEventUrl = Boolean(eventUrl);

    // Check if event is from previous year (2025)
    const parsedDisplayDate = parseDateValue(displayDate);
    const eventYear = parsedDisplayDate ? parsedDisplayDate.getFullYear() : null;
    const isPreviousYear = eventYear === currentYear - 1;

    return (
      <div key={sessionKey} className="glass-card p-5 rounded-xl flex flex-col gap-4 h-full">
        <div className="flex gap-4">
          {/* Left: Title, Icons, Space - 4 lines */}
          <div className="grow flex flex-col">
            {/* Lines 1-2: Title (max 2 lines) */}
            <h4 className="text-slate-900 dark:text-white font-semibold text-lg leading-tight line-clamp-2 mb-1">
              {displayName}
            </h4>

            {/* Line 3: Website and Video/Stream Icons */}
            <div className="flex gap-2">
              {hasEventUrl && (
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-foreground hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Event page"
                >
                  <span className="material-symbols-outlined text-[18px]">language</span>
                </a>
              )}
              {hasPresentation && (
                <a
                  href={presentationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Presentation"
                >
                  <span className="material-symbols-outlined text-[18px]">play_circle</span>
                </a>
              )}
            </div>

            {/* Line 4: Empty for spacing - handled by flex-grow in parent */}
          </div>

          {/* Right: Image - always reserves 80×80 space */}
          <div className="flex flex-col items-end">
            <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden flex items-center justify-center bg-slate-100 dark:bg-slate-800/60">
              {imageUrl ? (
                <button
                  type="button"
                  className="w-full h-full p-1 border-0 bg-transparent flex items-center justify-center cursor-pointer"
                  onClick={() => setSelectedImage(imageUrl)}
                  aria-label={`View image for ${displayName}`}
                >
                  <img
                    src={imageUrl}
                    alt={displayName}
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain hover:opacity-80 transition-opacity"
                    onError={(e) => {
                      const failedSrc = e.target.src;
                      if (imageFallback && failedSrc !== imageFallback) {
                        console.warn(
                          '[SpeakerEvent] Primary image failed, trying fallback:',
                          failedSrc,
                          '→',
                          imageFallback
                        );
                        e.target.src = imageFallback;
                      } else {
                        console.error(
                          '[SpeakerEvent] Image failed (no usable fallback):',
                          failedSrc
                        );
                        e.target.closest('button').style.display = 'none';
                      }
                    }}
                  />
                </button>
              ) : (
                <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-2xl select-none">
                  image
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grow">
          {(!isPreviousYear || isExpanded) && (
            <p
              className={`text-sm text-slate-700 dark:text-slate-400 leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}
            >
              {description}
            </p>
          )}
          {typeof description === 'string' && description.length > 200 && (
            <button
              onClick={() => setExpandedCard(isExpanded ? null : sessionKey)}
              className="text-accent-foreground hover:text-slate-900 dark:hover:text-white text-sm mt-1 transition-colors"
            >
              {isExpanded ? 'Show less' : '...'}
            </button>
          )}
          {isPreviousYear && !isExpanded && (
            <button
              onClick={() => setExpandedCard(isExpanded ? null : sessionKey)}
              className="text-accent-foreground hover:text-slate-900 dark:hover:text-white text-sm mt-1 transition-colors"
            >
              ...
            </button>
          )}
        </div>

        <div className="mt-auto pt-3 border-t border-slate-300/70 dark:border-slate-700/50">
          <div className="flex items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400">
            {/* Location on the left */}
            <div className="flex items-center gap-1">
              {displayLocationText ? (
                <>
                  <span className="material-symbols-outlined text-[16px]">location_on</span>
                  {locationLink ? (
                    <a
                      href={locationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-foreground hover:underline truncate"
                      title={displayLocationText}
                    >
                      {displayLocationText.includes('°')
                        ? `${displayLocationText} (GPS)`
                        : displayLocationText}
                    </a>
                  ) : (
                    <span className="truncate" title={displayLocationText}>
                      {displayLocationText}
                    </span>
                  )}
                </>
              ) : (
                <span>Virtual</span>
              )}
            </div>

            {/* Date on the right in Aptos font */}
            {displayDate && (
              <div className="flex items-center gap-1 whitespace-nowrap">
                <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                <span className="font-[Aptos]" style={{ fontFamily: 'Aptos, Inter, sans-serif' }}>
                  {formatDateLabel(displayDate)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSection = (title, events) => {
    if (events.length === 0) return null;
    return (
      <div className="space-y-8">
        <h4
          className="text-xl text-slate-900 dark:text-white uppercase tracking-wider"
          style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
        >
          {title}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map(renderSession)}
        </div>
      </div>
    );
  };

  const skeletonCard = (i) => (
    <div key={i} className="glass-card p-5 rounded-xl animate-pulse flex flex-col gap-4 h-52">
      <div className="flex gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mt-1" />
        </div>
        <div className="w-20 h-20 bg-slate-200 dark:bg-slate-700 rounded-lg shrink-0" />
      </div>
      <div className="space-y-2 flex-1">
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-4/6" />
      </div>
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mt-auto" />
    </div>
  );

  return (
    <div ref={containerRef} className="space-y-8">
      {loading && (
        <div className="space-y-8">
          <div className="h-5 w-36 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(skeletonCard)}
          </div>
        </div>
      )}
      {!loading && error && <div className="text-center py-8 text-slate-500 text-sm">{error}</div>}
      {!loading && !error && (
        <>
          <div>{renderSection('Coming Soon', comingSoonEvents)}</div>
          <div className="pt-12">
            {renderSection(`${currentYear} Speaking Engagements`, currentYearPastEvents)}
          </div>
          <div className="pt-12">
            {renderSection(`${currentYear - 1} Speaking Engagements`, previousYearEvents)}
          </div>
          {sessions.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              No speaking engagements found.
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="relative max-w-2xl max-h-[85vh] cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={selectedImage}
                alt="Event"
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
              <button
                onClick={() => setSelectedImage(null)}
                className="absolute -top-4 -right-4 text-white bg-black/70 hover:bg-black/90 rounded-full p-2 transition-colors"
                aria-label="Close image viewer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CustomSessionizeWidget;
