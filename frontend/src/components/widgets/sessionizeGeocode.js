/**
 * Locations for the speaking widget (ADR 0033, Spotlight slice): Nominatim
 * reverse geocoding for coordinates and forward geocoding for place names,
 * each cached in localStorage so a visitor pays for a lookup once. Every
 * function answers null rather than throwing; the widget then shows what it
 * has — the coordinates, or the stored text.
 *
 * Workflow for one event (`resolveLocation`):
 * - coordinates → reverseGeocode → "City, State" or "City, Country"
 * - a location string → forwardGeocode → reverseGeocode → the same
 * - nothing usable → the stored text, which the card shows as "Virtual" when empty
 */
import { formatLocationFromAddress, isVirtual, parseCoords } from './sessionizeEvents';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const JSON_HEADERS = { headers: { Accept: 'application/json' } };

const inRange = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && inRange(lat, lng);

/** "City, State" / "City, Country" for coordinates; null when Nominatim cannot say. */
export async function reverseGeocode(lat, lng) {
  try {
    if (!validCoords(lat, lng)) return null;
    const cacheKey = `geocode:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
    const resp = await fetch(
      `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      JSON_HEADERS
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const label = formatLocationFromAddress(data.address || {});
    if (label) localStorage.setItem(cacheKey, label);
    return label || null;
  } catch {
    return null;
  }
}

const placeOf = (row) => ({
  lat: parseFloat(row.lat),
  lng: parseFloat(row.lon),
  address: row.address || {},
});

/** One Nominatim search: `{ place }` (null when nothing matched), or `{ failed }` when the request was refused. */
async function searchPlace(query, params = '') {
  const resp = await fetch(
    `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json${params}&limit=1&addressdetails=1`,
    JSON_HEADERS
  );
  if (!resp.ok) return { failed: true };
  const data = await resp.json();
  const [row] = Array.isArray(data) ? data : [];
  return { place: row ? placeOf(row) : null };
}

/** Coordinates and the address for a place name; the United States first, then anywhere. */
export async function forwardGeocode(locationString) {
  try {
    if (!locationString || typeof locationString !== 'string') return null;
    const cacheKey = `forward-geocode:${locationString}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
    let found = await searchPlace(locationString, '&countrycodes=us');
    if (!found.failed && !found.place) found = await searchPlace(locationString);
    const place = found.place || null;
    if (place?.lat && place?.lng) localStorage.setItem(cacheKey, JSON.stringify(place));
    return place;
  } catch (err) {
    console.error('Forward geocoding error:', err);
    return null;
  }
}

/** The coordinates an event carries: a "lat, lng" location, `location_coords`, or a GeoPoint location — in that order. */
function eventCoords(event) {
  const fromText = typeof event.location === 'string' ? parseCoords(event.location) : null;
  const fromObject = typeof event.location === 'object' ? parseCoords(event.location) : null;
  return fromText || parseCoords(event.location_coords) || fromObject;
}

/** A label for a free-text location: geocode it, then read the place back; undefined when nothing was found. */
async function labelForText(text) {
  const place = await forwardGeocode(text);
  if (!place?.lat || !place?.lng) return undefined;
  const label = await reverseGeocode(place.lat, place.lng);
  if (label) return label;
  return place.address ? formatLocationFromAddress(place.address) : undefined;
}

const geocodable = (text) => typeof text === 'string' && Boolean(text) && !isVirtual(text);

/** The location one event shows, by the workflow above. */
async function resolveLocation(event) {
  const coords = eventCoords(event);
  if (coords) {
    return (await reverseGeocode(coords.lat, coords.lng)) || `${coords.lat}, ${coords.lng}`;
  }
  const text = event.location;
  if (geocodable(text)) return (await labelForText(text)) ?? text;
  return text;
}

/** Every event with its location resolved, one at a time so Nominatim is not flooded. */
export async function resolveLocations(events) {
  const out = [];
  for (const event of events) {
    out.push({ ...event, location: await resolveLocation(event) });
  }
  return out;
}
