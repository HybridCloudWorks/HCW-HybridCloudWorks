import React, { useState, useEffect, useCallback } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Mic,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  Link,
  ExternalLink,
  Image as ImageIcon,
  Check,
  X,
  Download,
} from 'lucide-react';
import { postJSON, getJSON } from '@/lib/api';
import PublishSnapshotButton from '@/components/admin/PublishSnapshotButton';
import { getSessionizeSpeakerId } from '@/lib/adminSettings';

// Only the fields the user manually provides — Sessionize ID/name/date come from the API
const EMPTY_FORM = {
  description: '',
  location: '',
  eventUrl: '',
  presentationUrl: '',
  eventImageUrl: '',
  display: true,
};

function parseDateValue(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue?.toDate === 'function') return dateValue.toDate();
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    // Accept either YYYY-MM-DD or a full ISO timestamp; anchor at local noon.
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day), 12);
    }
  }
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInputDate(isoOrStr) {
  if (!isoOrStr) return '';
  if (typeof isoOrStr === 'string') {
    const trimmed = isoOrStr.trim();
    // Match the leading YYYY-MM-DD even if a full ISO timestamp is supplied.
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[0];
  }
  const d = parseDateValue(isoOrStr);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSyncPatch(existing, sessionizeEvent, sessionizeId) {
  const patch = {};
  if (!existing.eventId) patch.eventId = sessionizeId;
  if (!existing.sessionizeId) patch.sessionizeId = sessionizeId;
  if (!existing.eventName?.trim()) patch.eventName = sessionizeEvent.name;
  if (!existing.name?.trim()) patch.name = sessionizeEvent.name;
  if (!existing.date) {
    patch.date = sessionizeEvent.date || null;
  }
  if (!existing.location && sessionizeEvent.location) patch.location = sessionizeEvent.location;
  if (!existing.eventUrl && sessionizeEvent.website) patch.eventUrl = sessionizeEvent.website;
  return patch;
}

function buildSessionizeCreatePayload(sessionizeEvent, sessionizeId) {
  return {
    eventId: sessionizeId,
    sessionizeId,
    eventName: sessionizeEvent.name,
    name: sessionizeEvent.name,
    date: sessionizeEvent.date || null,
    location: sessionizeEvent.location || null,
    eventUrl: sessionizeEvent.website || null,
    display: true,
  };
}

function buildBaseSpeakingPayload(form) {
  return {
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    eventUrl: form.eventUrl.trim() || null,
    presentationUrl: form.presentationUrl.trim() || null,
    eventImageUrl: form.eventImageUrl.trim() || null,
    display: form.display,
  };
}

function buildManualSpeakingPayload(form) {
  return {
    eventName: (form._manualName || '').trim(),
    name: (form._manualName || '').trim(),
    date: form._manualDate || null,
  };
}

function buildSessionizeSpeakingPayload(editingEvent) {
  const payload = {};
  const existingDoc = editingEvent._storedDoc || null;

  if (!existingDoc?.eventId) payload.eventId = Number(editingEvent.id);
  if (!existingDoc?.sessionizeId) payload.sessionizeId = Number(editingEvent.id);
  if (!existingDoc?.eventName?.trim()) payload.eventName = editingEvent.name;
  if (!existingDoc?.name?.trim()) payload.name = editingEvent.name;
  if (!existingDoc?.date && editingEvent.date) {
    payload.date = editingEvent.date;
  }

  return payload;
}

function buildSpeakingEventPayload(editingEvent, form) {
  const payload = buildBaseSpeakingPayload(form);

  if (!editingEvent) {
    Object.assign(payload, buildManualSpeakingPayload(form));
    return payload;
  }

  Object.assign(payload, buildSessionizeSpeakingPayload(editingEvent));

  return payload;
}

// Format date as MM/DD/YYYY
function formatShortDate(dateValue) {
  if (!dateValue) return '—';
  const d = parseDateValue(dateValue);
  if (!d) return '—';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

// Convert date value to timestamp for sorting
function getDateTimestamp(dateValue) {
  if (!dateValue) return 0;
  const d = parseDateValue(dateValue);
  return d ? d.getTime() : 0;
}

export default function SpeakingEventsPage() {
  const { authReady } = useAuthReady();
  const [sessionizeEvents, setSessionizeEvents] = useState([]);
  const [storedDocs, setStoredDocs] = useState([]);
  const [loadingSessionize, setLoadingSessionize] = useState(true);
  const [loadingStored, setLoadingStored] = useState(false);
  const [saving, setSaving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // editingId: null=closed, 'new'=manual entry, else docId of an existing stored override
  // editingEvent: the Sessionize event row being enriched (for 'new' from table row)
  const [editingId, setEditingId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);

  const loadSessionize = useCallback(async () => {
    setLoadingSessionize(true);
    try {
      // Speaker ID lives in the admin settings doc (editable on the
      // Connections page) with a constant fallback.
      const speakerId = await getSessionizeSpeakerId();
      const res = await fetch(`https://sessionize.com/api/speaker/json/${speakerId}`);
      if (!res.ok) throw new Error(`Sessionize HTTP ${res.status}`);
      const data = await res.json();
      setSessionizeEvents(
        (data.events || []).map((e) => ({
          id: e.id,
          name: e.name || '',
          date: e.eventStartDate || null,
          location: e.location || null,
          website: e.website || null,
        }))
      );
    } catch (err) {
      setError(`Failed to load Sessionize: ${err.message}`);
    } finally {
      setLoadingSessionize(false);
    }
  }, []);

  const loadStoredDocs = useCallback(async () => {
    setLoadingStored(true);
    try {
      const res = await getJSON('cms/speakerevents');
      setStoredDocs((res.items || []).map((item) => ({ _docId: item.id, ...item })));
    } catch (err) {
      setError(`Failed to load stored event data: ${err.message}`);
    } finally {
      setLoadingStored(false);
    }
  }, []);

  useEffect(() => {
    loadSessionize(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadSessionize]);

  // Wait for auth before loading stored overrides through the Azure API.
  useEffect(() => {
    if (authReady) loadStoredDocs(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [authReady, loadStoredDocs]);

  // Safely convert any value to a display string — handles structured location objects.
  const safeString = (val) => {
    if (!val) return null;
    if (typeof val === 'string') return val;
    // Structured location: { _lat, _long } or { latitude, longitude }
    if (typeof val === 'object') {
      const lat = val._lat ?? val.latitude;
      const lng = val._long ?? val.longitude;
      if (lat !== undefined && lng !== undefined) return `${lat}, ${lng}`;
      return null; // unknown object — don't render it
    }
    return String(val);
  };

  // Helper: resolve the canonical numeric ID from a stored record.
  const fdNumericId = (fd) => {
    const v = fd.eventId ?? fd.sessionizeId;
    return v ? Number(v) : null;
  };

  // Merged: each Sessionize event paired with its stored override (if any).
  // Match by eventId only — consistent with sync logic
  const mergedEvents = sessionizeEvents
    .map((se) => {
      const fd = storedDocs.find((d) => fdNumericId(d) === Number(se.id));
      return { ...se, _storedDoc: fd || null };
    })
    .sort((a, b) => {
      // Sort by date descending (newest first)
      const dateA = getDateTimestamp(a.date);
      const dateB = getDateTimestamp(b.date);
      return dateB - dateA;
    });

  // Manual entries with no matching Sessionize event by eventId.
  const manualEntries = storedDocs
    .filter((fd) => {
      const id = fdNumericId(fd);
      if (id && sessionizeEvents.some((se) => Number(se.id) === id)) return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by date descending (newest first)
      const dateA = getDateTimestamp(a.date);
      const dateB = getDateTimestamp(b.date);
      return dateB - dateA;
    });

  const openEnrich = (sessionizeEvent) => {
    const fd = sessionizeEvent._storedDoc;
    setEditingEvent(sessionizeEvent);
    setForm({
      description: fd?.description || '',
      location: safeString(fd?.location) || safeString(sessionizeEvent.location) || '',
      eventUrl: fd?.eventUrl || sessionizeEvent.website || '',
      presentationUrl: fd?.presentationUrl || '',
      eventImageUrl: fd?.eventImageUrl || '',
      display: fd?.display !== false,
    });
    setEditingId(fd ? fd._docId : 'new');
  };

  const openManual = () => {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, _manualName: '', _manualDate: '' });
    setEditingId('new');
  };

  const openEditManual = (fd) => {
    setEditingEvent(null);
    setForm({
      description: fd.description || '',
      location: safeString(fd.location) || '',
      eventUrl: fd.eventUrl || '',
      presentationUrl: fd.presentationUrl || '',
      eventImageUrl: fd.eventImageUrl || '',
      display: fd.display !== false,
      _manualName: fd.eventName || fd.name || '',
      _manualDate: toInputDate(fd.date),
    });
    setEditingId(fd._docId);
  };

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const handleSyncAll = async () => {
    if (sessionizeEvents.length === 0) {
      setError('Sessionize data not loaded yet — hit Refresh first.');
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    let created = 0;
    let patched = 0;
    let skipped = 0;
    try {
      for (const se of sessionizeEvents) {
        const seId = Number(se.id);

        // Match ONLY by eventId — name matching is no longer used for sync
        const existing = storedDocs.find((fd) => fdNumericId(fd) === seId) || null;

        if (existing) {
          const patch = buildSyncPatch(existing, se, seId);

          if (Object.keys(patch).length > 0) {
            await postJSON('upsertSpeakerEvent', {
              docId: existing._docId,
              data: patch,
              merge: true,
            });
            patched++;
          } else {
            skipped++;
          }
          continue;
        }

        // No matching eventId — create a new row with everything the API provides
        await postJSON('upsertSpeakerEvent', {
          docId: `event-${seId}`,
          merge: false,
          data: buildSessionizeCreatePayload(se, seId),
        });
        created++;
      }
      await loadStoredDocs();
      setSyncResult({ created, patched, skipped });
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditingEvent(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    const docId = editingId === 'new' ? `event-${editingEvent?.id || Date.now()}` : editingId;

    setSaving(docId);
    try {
      const payload = buildSpeakingEventPayload(editingEvent, form);

      await postJSON('upsertSpeakerEvent', {
        docId,
        data: payload,
        merge: true,
      });
      await loadStoredDocs();
      closeEdit();
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (docId) => {
    if (
      !window.confirm(
        'Delete this stored override? The event will still show from Sessionize without custom data.'
      )
    )
      return;
    setDeleting(docId);
    try {
      await postJSON('deleteSpeakerEvent', { docId });
      await loadStoredDocs();
      if (editingId === docId) closeEdit();
    } catch (err) {
      setError(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const loading = loadingSessionize || loadingStored;

  const renderForm = () => {
    const isManual = !editingEvent;
    const canSave = isManual ? Boolean((form._manualName || '').trim()) : true;

    return (
      <Card className="border-2 border-slate-blue/30">
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-sm">
                {editingId === 'new' ? 'New Override' : 'Edit Override'}
              </h3>
              {editingEvent && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sessionize #{editingEvent.id} · {editingEvent.name}
                  {editingEvent.date && <> · {formatShortDate(editingEvent.date)}</>}
                </p>
              )}
            </div>
            <button onClick={closeEdit} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Manual entries only: name + date */}
            {isManual && (
              <>
                <div className="space-y-1">
                  <label
                    htmlFor="speaking-event-name"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Event Name *
                  </label>
                  <input
                    type="text"
                    className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                    placeholder="Event name as shown on site"
                    id="speaking-event-name"
                    value={form._manualName || ''}
                    onChange={(e) => setForm((f) => ({ ...f, _manualName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="speaking-event-date"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Date
                  </label>
                  <input
                    type="date"
                    className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                    id="speaking-event-date"
                    value={form._manualDate || ''}
                    onChange={(e) => setForm((f) => ({ ...f, _manualDate: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="space-y-1 md:col-span-2">
              <label
                htmlFor="speaking-event-description"
                className="text-xs font-medium text-muted-foreground"
              >
                Description
              </label>
              <textarea
                rows={3}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background resize-none"
                placeholder="Override the Sessionize description, or add one if missing"
                id="speaking-event-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="speaking-event-location"
                className="text-xs font-medium text-muted-foreground"
              >
                Location override
              </label>
              <input
                type="text"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                placeholder="e.g. Chicago, IL or Virtual"
                id="speaking-event-location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="speaking-event-url"
                className="text-xs font-medium text-muted-foreground"
              >
                Event URL override
              </label>
              <input
                type="url"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                placeholder="https://..."
                id="speaking-event-url"
                value={form.eventUrl}
                onChange={(e) => setForm((f) => ({ ...f, eventUrl: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="speaking-event-presentation-url"
                className="text-xs font-medium text-muted-foreground"
              >
                Presentation URL
              </label>
              <input
                type="url"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                placeholder="https://..."
                id="speaking-event-presentation-url"
                value={form.presentationUrl}
                onChange={(e) => setForm((f) => ({ ...f, presentationUrl: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="speaking-event-image-url"
                className="text-xs font-medium text-muted-foreground"
              >
                Event Image URL
              </label>
              <input
                type="url"
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background"
                placeholder="https://example.com/event-image.jpg"
                id="speaking-event-image-url"
                value={form.eventImageUrl}
                onChange={(e) => setForm((f) => ({ ...f, eventImageUrl: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-2 self-end">
              <input
                type="checkbox"
                id="display-toggle"
                checked={form.display}
                onChange={(e) => setForm((f) => ({ ...f, display: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="display-toggle" className="text-sm">
                Show on site
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={Boolean(saving) || !canSave}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={closeEdit}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mic className="h-6 w-6" />
            Speaking Events
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ID, name, and date come from Sessionize automatically. Use <strong>Enrich</strong> to
            add description, image, and links.
          </p>
        </div>
        <div className="flex gap-2">
          <PublishSnapshotButton />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadSessionize();
              if (authReady) loadStoredDocs();
            }}
            disabled={loading || syncing}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={loading || syncing || storedDocs.length === 0}
            title="Create stored records for any new Sessionize events — existing records are never touched"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            Sync from Sessionize
          </Button>
          <Button size="sm" onClick={openManual}>
            <Plus className="h-4 w-4 mr-1" />
            Manual Entry
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {syncResult && (
        <div className="text-sm bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2 flex items-center justify-between">
          <span>
            Sync complete — <strong>{syncResult.created}</strong> new row
            {syncResult.created !== 1 ? 's' : ''} created, <strong>{syncResult.patched}</strong>{' '}
            existing row{syncResult.patched !== 1 ? 's' : ''} filled in (empty fields only),{' '}
            <strong>{syncResult.skipped}</strong> already complete.
          </span>
          <button onClick={() => setSyncResult(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {editingId !== null && renderForm()}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Sessionize events table */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Sessionize Events ({sessionizeEvents.length})
            </h2>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-16">
                      ID
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-28">
                      Date
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      Event Name
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell w-44">
                      Location
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-28">
                      Stored override
                    </th>
                    <th className="px-4 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mergedEvents.map((ev) => {
                    const fd = ev._storedDoc;
                    const isEditing = editingEvent?.id === ev.id;
                    return (
                      <tr
                        key={ev.id}
                        className={`transition-colors ${isEditing ? 'bg-blue-50 dark:bg-blue-950/20' : 'hover:bg-muted/30'}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                          {ev.id}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                          {formatShortDate(ev.date)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium leading-snug">{ev.name}</div>
                          {fd?.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {fd.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs max-w-44 truncate">
                          {safeString(fd?.location) || safeString(ev.location) || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {fd ? (
                            <div className="flex flex-col gap-1">
                              <Badge
                                variant="outline"
                                className="text-xs text-green-600 border-green-300 w-fit gap-1"
                              >
                                <Check className="h-3 w-3" /> Enriched
                              </Badge>
                              <div className="flex gap-1.5">
                                <ImageIcon
                                  className={`h-3 w-3 ${fd.eventImageUrl ? 'text-blue-400' : 'text-muted-foreground/25'}`}
                                  title={fd.eventImageUrl ? 'Has image' : 'No image'}
                                />
                                {fd.eventUrl && (
                                  <Link className="h-3 w-3 text-blue-400" title="Has event URL" />
                                )}
                                {fd.presentationUrl && (
                                  <ExternalLink
                                    className="h-3 w-3 text-purple-400"
                                    title="Has presentation"
                                  />
                                )}
                                {fd.display === false && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs text-amber-600 border-amber-300 ml-0.5"
                                  >
                                    hidden
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground w-fit"
                            >
                              API only
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm"
                              variant={fd ? 'ghost' : 'outline'}
                              className="h-7 px-2.5 text-xs"
                              onClick={() => openEnrich(ev)}
                              disabled={isEditing}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              {fd ? 'Edit' : 'Enrich'}
                            </Button>
                            {fd && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => handleDelete(fd._docId)}
                                disabled={deleting === fd._docId}
                              >
                                {deleting === fd._docId ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manual entries */}
          {manualEntries.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Manual Entries — Stored Only ({manualEntries.length})
              </h2>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-28">
                        Date
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                        Display
                      </th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {manualEntries.map((fd) => (
                      <tr key={fd._docId} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                          {formatShortDate(fd.date)}
                        </td>
                        <td className="px-4 py-3 font-medium">{fd.eventName || fd.name || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`text-xs w-fit ${fd.display ? 'text-green-600 border-green-300' : 'text-muted-foreground'}`}
                          >
                            {fd.display ? 'Visible' : 'Hidden'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => openEditManual(fd)}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => handleDelete(fd._docId)}
                              disabled={deleting === fd._docId}
                            >
                              {deleting === fd._docId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 space-y-1">
            <p className="font-medium">How it works</p>
            <p>
              Sessionize is fetched live — ID, name, and date are always taken from the API and
              saved through the Azure API when you click Save.
            </p>
            <p>
              Any field you leave blank here falls back to the Sessionize value on the public site.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
