/**
 * Admin CRUD — certifications and social posts (api-surface adminWrites,
 * first two slices in the contract's page-usage order).
 *
 * Like the public reads, there is no backend source to port: the admin pages
 * called Firestore directly (CertificationsPage.jsx addDoc/updateDoc/
 * deleteDoc, SocialHubPage.jsx addDoc/deleteDoc + status-filtered list).
 * Semantics mirror those call sites so the pages can swap fetch targets
 * without behavior change:
 *
 *   - certifications: list ALL docs (the page filters/sorts client-side on
 *     display_order), create stamps _createdAt/_updatedAt, edits are PARTIAL
 *     patches stamping _updatedAt — the page's patchCert() sends single-field
 *     toggles, so a whole-doc replace would drop everything else.
 *   - social_posts: list filtered to status IN (scheduled, published) newest
 *     first (createdAt is sorted in memory — Cosmos ORDER BY drops docs
 *     missing the property, same trap as public-reads), create stamps
 *     createdAt, delete by id.
 *
 * Every route sits behind the editor role guard; these were previously
 * "protected" only by Firestore rules that trusted the admin custom claim.
 */
import { randomUUID } from 'node:crypto';
import { isValidBlobPath } from './blob-paths.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_DOC_JSON = 120_000;

function validBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (JSON.stringify(body).length > MAX_DOC_JSON) return null;
  return body;
}

const createdAtValue = (doc) => {
  const v = doc.createdAt || doc._createdAt || null;
  if (!v) return 0;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const SOCIAL_DEFAULT_STATUSES = ['scheduled', 'published'];
/** What PATCH may change on a social post; everything else is Publer's or the timer's. */
const SOCIAL_EDITABLE = ['caption', 'url', 'scheduledAt'];
const MAX_CAPTION = 5000;
const LIST_WINDOW = 1000;

// ── certification validation (ADR 0033 §4, Spotlight slice) ───────────────

const CERT_DATE_FIELDS = ['issueDate', 'expDate', 'renewalDate'];
const CERT_URL_FIELDS = ['verifyUrl', 'learnUrl'];

/**
 * A calendar date as plain `YYYY-MM-DD`, from a day, a timestamp (its
 * leading day) or a Date; null for nothing usable. Dates used to be stored
 * as UTC midnight and shown a day early west of Greenwich (ADR 0033 §1).
 */
export function toCalendarDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  const head = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const [y, m, d] = head.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === head ? head : null;
}

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
/** An uploaded badge is stored site-relative (`/api/public/media/…`, blob-paths.js). */
const isImageRef = (value) =>
  isHttpUrl(value) || (typeof value === 'string' && /^\/[^\s]+$/.test(value.trim()));

function cleanLinkList(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string')
        return isHttpUrl(item) ? { label: item.trim(), url: item.trim() } : null;
      if (!item || typeof item !== 'object' || !isHttpUrl(item.url)) return null;
      const url = String(item.url).trim();
      return {
        label:
          String(item.label || '')
            .trim()
            .slice(0, 200) || url,
        url,
      };
    })
    .filter(Boolean)
    .slice(0, max);
}

/**
 * The certification fields a write may carry, cleaned, or an error
 * sentence. Not an allowlist — migrated documents carry legacy spellings
 * nothing sends any more — but every field that has a shape is checked:
 * dates become calendar days and the expiry may not precede the issue date
 * (read from `existing` when a partial patch sends only one of them), URLs
 * must be http(s), `display_order` is a whole number and 0 is allowed.
 */
export function validateCertification(body, existing = null) {
  const out = { ...body };
  delete out.id;
  for (const step of CERT_STEPS) {
    const error = step(out, existing);
    if (error) return { error };
  }
  return { value: out };
}

const isBlank = (value) => value === undefined || value === null || value === '';

/** Each step cleans `out` in place and answers an error sentence, or null. */
function cleanCertDates(out, existing) {
  for (const key of CERT_DATE_FIELDS) {
    if (!(key in out)) continue;
    if (out[key] === null || out[key] === '') {
      out[key] = null;
      continue;
    }
    const day = toCalendarDate(out[key]);
    if (!day) return `${key} must be a YYYY-MM-DD date`;
    out[key] = day;
  }
  const issue = 'issueDate' in out ? out.issueDate : toCalendarDate(existing?.issueDate);
  const exp = 'expDate' in out ? out.expDate : toCalendarDate(existing?.expDate);
  const inverted = issue && exp && exp < issue;
  return inverted ? 'expDate must be on or after issueDate' : null;
}

function cleanCertUrls(out) {
  for (const key of CERT_URL_FIELDS) {
    if (isBlank(out[key])) continue;
    if (!isHttpUrl(out[key])) return `${key} must be an http(s) URL`;
    out[key] = String(out[key]).trim();
  }
  if (isBlank(out.imageUrl)) return null;
  if (!isImageRef(out.imageUrl)) return 'imageUrl must be an http(s) URL or an uploaded media path';
  out.imageUrl = String(out.imageUrl).trim();
  return null;
}

function cleanDisplayOrder(out) {
  const order = 'display_order' in out ? out.display_order : null;
  if (order === null || order === undefined) return null;
  const n = Number(out.display_order);
  if (!Number.isInteger(n) || n < 0) return 'display_order must be a whole number of 0 or more';
  out.display_order = n;
  return null;
}

function cleanCertLists(out) {
  if ('evidence' in out) out.evidence = cleanLinkList(out.evidence);
  if ('relatedLearning' in out) out.relatedLearning = cleanLinkList(out.relatedLearning);
  if ('renewalRequirements' in out && out.renewalRequirements !== null) {
    out.renewalRequirements = String(out.renewalRequirements).trim().slice(0, 4000);
  }
  return null;
}

/** In the order their errors are reported. */
const CERT_STEPS = [cleanCertDates, cleanCertUrls, cleanDisplayOrder, cleanCertLists];

/** `{docId}/images/…` inside the certifications container — the only shape the editor uploads. */
export function isCertImagePath(path) {
  return isValidBlobPath(path) && /^[^/]+\/images\/[^/]+$/.test(path);
}

/** Delete an abandoned badge upload: only at a cert image path, never one a stored certification still references. */
async function deleteCertImage({ store, storage }, path) {
  if (!isCertImagePath(path)) {
    return json(400, { error: 'path must be a certification image path ({docId}/images/…)' });
  }
  const referencing = await store.queryDocs(
    'certifications',
    'SELECT TOP 1 c.id FROM c WHERE CONTAINS(c.imageUrl, @path)',
    [{ name: '@path', value: path }]
  );
  if (referencing.length > 0) {
    return json(409, { error: 'A stored certification still references this image' });
  }
  await storage.deleteBlob('certifications', path);
  return json(200, { success: true, path });
}

// ── social post edits (ADR 0033 Amplify slice) ─────────────────────────────

/** One editable field each: the cleaned value, or the sentence refusing it. */
const SOCIAL_FIELD_CLEANERS = {
  caption(value) {
    const caption = typeof value === 'string' ? value.trim() : '';
    if (!caption || caption.length > MAX_CAPTION) {
      return { error: `caption must be 1 to ${MAX_CAPTION} characters` };
    }
    return { value: caption };
  },
  url(value) {
    const url = value === null ? null : String(value).trim();
    if (url && !/^https?:\/\//i.test(url)) return { error: 'url must be absolute http(s)' };
    return { value: url || null };
  },
  scheduledAt(value, nowMs) {
    if (value === null) {
      return { error: 'scheduledAt cannot be cleared; delete the post to cancel it' };
    }
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return { error: 'scheduledAt must be an ISO instant' };
    if (when.getTime() <= nowMs) return { error: 'scheduledAt must be in the future' };
    return { value: when.toISOString() };
  },
};

/** The body of a social-post PATCH as `{ updates }`, or `{ error }` naming the first bad field. */
export function validateSocialPostPatch(body, nowMs) {
  const unknown = Object.keys(body).filter((key) => !SOCIAL_EDITABLE.includes(key));
  if (unknown.length) return { error: `Unknown field(s): ${unknown.join(', ')}` };
  const updates = {};
  for (const key of SOCIAL_EDITABLE) {
    if (body[key] === undefined) continue;
    const cleaned = SOCIAL_FIELD_CLEANERS[key](body[key], nowMs);
    if (cleaned.error) return cleaned;
    updates[key] = cleaned.value;
  }
  return { updates };
}

/** Why a stored post refuses this edit, or null. */
export function socialPostEditRefusal(existing, updates) {
  if (existing.status === 'published') return 'A published post cannot be edited or rescheduled.';
  if (updates.scheduledAt && existing.status !== 'scheduled') {
    return `Only a scheduled post can be rescheduled; this one is ${existing.status}.`;
  }
  return null;
}

/** The stored post an edit applies to, or the refusal (404, 409). */
async function loadEditableSocialPost(store, id, updates) {
  const existing = await store.readDoc('social_posts', id, id);
  if (!existing) return { error: json(404, { error: `social post ${id} not found` }) };
  const refusal = socialPostEditRefusal(existing, updates);
  return refusal ? { error: json(409, { error: refusal }) } : { existing };
}

/** Route id, validated body and the stored post, or the response that refuses the edit. */
async function prepareSocialPostEdit({ store, now }, request) {
  const id = String(request.params.id || '').trim();
  if (!id) return { error: json(400, { error: 'id required' }) };
  const body = validBody(await request.json().catch(() => null));
  if (!body || Object.keys(body).length === 0) {
    return { error: json(400, { error: 'Body must be a non-empty JSON object' }) };
  }
  const checked = validateSocialPostPatch(body, now().getTime());
  if (checked.error) return { error: json(400, { error: checked.error }) };
  const loaded = await loadEditableSocialPost(store, id, checked.updates);
  return loaded.error ? loaded : { id, updates: checked.updates, existing: loaded.existing };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {{ deleteBlob: Function }} [deps.storage] — for the editor's cancel path
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createAdminCrudHandlers({
  guard,
  store,
  storage = null,
  now = () => new Date(),
  uuid = randomUUID,
  unpublishSocialPost = null,
}) {
  return {
    // ── blogs ──────────────────────────────────────────────────────────────

    /**
     * DELETE /api/cms/blogs/{id} — publisher. Site-Main's createSlugPageOnTrigger
     * wrote the curated slug-page fields ONTO the blog document, so removing
     * the slug page is removing the document (T-324, the first of the three
     * deletes the change feed cannot see). Audited.
     */
    async deleteBlog(request, context) {
      const auth = await guard.requireRole(request, 'publisher');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const existing = await store.readDoc('blogs', id, id);
        if (!existing) return json(404, { error: `Blog ${id} not found` });
        await store.deleteDoc('blogs', id, id);
        const { user } = auth;
        await store.upsertDoc('admin_audit_logs', {
          id: uuid(),
          action: 'blog_deleted',
          userId: user?.oid || user?.sub || null,
          userEmail: user?.email || null,
          timestamp: now().toISOString(),
          details: {
            blogId: id,
            slug: existing.slug || existing.Slug || null,
            curatedSubpagePath: existing.curatedSubpagePath || null,
          },
          userAgent: request.headers?.get?.('user-agent') || null,
          contentId: existing.sourceContentId || null,
          contentTitle: existing.Title || existing.title || '',
          compliance: {
            schemaVersion: 1,
            detailsSanitized: true,
            identityVerified: true,
          },
        });
        return json(200, { success: true, blogId: id });
      } catch (error) {
        context.error('deleteBlog failed:', error);
        return json(500, { error: 'Failed to delete blog' });
      }
    },

    // ── certifications ─────────────────────────────────────────────────────

    /** GET /api/cms/certifications — all docs; the page sorts client-side. */
    async listCertifications(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const items = await store.queryDocs(
          'certifications',
          `SELECT TOP ${LIST_WINDOW} * FROM c`,
          []
        );
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listCertifications failed:', error);
        return json(500, { error: 'Failed to list certifications' });
      }
    },

    /** POST /api/cms/certifications — create; name is the page's one required field. */
    async createCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });
        if (!String(body.name || '').trim()) return json(400, { error: 'name is required' });
        const checked = validateCertification(body);
        if (checked.error) return json(400, { error: checked.error });

        const nowIso = now().toISOString();
        const doc = {
          ...checked.value,
          id: uuid(), // never client-chosen — matches addDoc semantics
          _createdAt: nowIso,
          _updatedAt: nowIso,
        };
        await store.upsertDoc('certifications', doc);
        return json(200, { success: true, id: doc.id, item: doc });
      } catch (error) {
        context.error('createCertification failed:', error);
        return json(500, { error: 'Failed to create certification' });
      }
    },

    /** PATCH /api/cms/certifications/{id} — partial update, stamps _updatedAt. */
    async patchCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const body = validBody(await request.json().catch(() => null));
        if (!body || Object.keys(body).length === 0) {
          return json(400, { error: 'Body must be a non-empty JSON object' });
        }
        const existing = await store.readDoc('certifications', id, id);
        if (!existing) return json(404, { error: `certification ${id} not found` });

        const checked = validateCertification(body, existing);
        if (checked.error) return json(400, { error: checked.error });
        const updated = await store.patchDoc('certifications', id, {
          ...checked.value,
          _updatedAt: now().toISOString(),
        });
        return json(200, { success: true, item: updated });
      } catch (error) {
        context.error('patchCertification failed:', error);
        return json(500, { error: 'Failed to update certification' });
      }
    },

    /**
     * DELETE /api/cms/certifications/images — body `{ path }`. The editor's
     * cancel path: a badge uploaded and then abandoned would otherwise sit
     * in the container until the nightly cleanup's seven-day rule (ADR 0033,
     * Spotlight slice). Only `{docId}/images/…` paths, and never a blob a
     * stored certification still references.
     */
    async deleteCertificationImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        if (!storage?.deleteBlob) return json(503, { error: 'Blob storage is not configured' });
        const body = validBody(await request.json().catch(() => null));
        return await deleteCertImage({ store, storage }, String(body?.path || '').trim());
      } catch (error) {
        context.error('deleteCertificationImage failed:', error);
        return json(500, { error: 'Failed to delete certification image' });
      }
    },

    /** DELETE /api/cms/certifications/{id} */
    async deleteCertification(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        await store.deleteDoc('certifications', id);
        return json(200, { success: true });
      } catch (error) {
        context.error('deleteCertification failed:', error);
        return json(500, { error: 'Failed to delete certification' });
      }
    },

    // ── social posts ───────────────────────────────────────────────────────

    /**
     * GET /api/cms/social-posts?status=a,b&limit= — SocialHubPage list.
     * status=all lists every post regardless of status (CalendarPage reads
     * the unfiltered collection).
     */
    async listSocialPosts(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const statusParam = String(request.query.get('status') || '').trim();
        const statuses = statusParam
          ? statusParam
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : SOCIAL_DEFAULT_STATUSES;
        const limit = Math.min(Math.max(Number(request.query.get('limit')) || 50, 1), 100);

        const unfiltered = statuses.includes('all');
        const items = await store.queryDocs(
          'social_posts',
          unfiltered
            ? `SELECT TOP ${LIST_WINDOW} * FROM c`
            : `SELECT TOP ${LIST_WINDOW} * FROM c WHERE ARRAY_CONTAINS(@statuses, c.status)`,
          unfiltered ? [] : [{ name: '@statuses', value: statuses }]
        );
        const sorted = items.sort((a, b) => createdAtValue(b) - createdAtValue(a)).slice(0, limit);
        return json(200, {
          success: true,
          items: sorted,
          total: sorted.length,
        });
      } catch (error) {
        context.error('listSocialPosts failed:', error);
        return json(500, { error: 'Failed to list social posts' });
      }
    },

    /** POST /api/cms/social-posts — create, stamps createdAt (source :273). */
    async createSocialPost(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });

        const doc = {
          ...body,
          id: uuid(),
          createdAt: now().toISOString(),
        };
        await store.upsertDoc('social_posts', doc);
        return json(200, { success: true, id: doc.id, item: doc });
      } catch (error) {
        context.error('createSocialPost failed:', error);
        return json(500, { error: 'Failed to create social post' });
      }
    },

    /**
     * PATCH /api/cms/social-posts/{id} — edit the caption, URL or time of a
     * post this hub recorded (ADR 0033 Amplify slice: edit + reschedule from
     * the Social Hub and the Calendar). The write is the whole push: the
     * social_posts change feed (lib/triggers/handlers.js socialPosts) sees a
     * changed `caption`/`url`/`scheduledAt` marker with `syncOrigin:
     * 'calendar'` and PUTs the post to Publer for every id it holds. A post
     * Publer has not yet reported ids for is picked up by the next
     * syncSocialCalendar run, and the answer says which.
     */
    async patchSocialPost(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const prepared = await prepareSocialPostEdit({ store, now }, request);
        if (prepared.error) return prepared.error;
        const { id, updates, existing } = prepared;
        const publerPostIds = Array.isArray(existing.publerPostIds) ? existing.publerPostIds : [];
        const updated = await store.patchDoc('social_posts', id, {
          ...updates,
          updatedAt: now().toISOString(),
          updatedBy: auth.user?.email || auth.user?.oid || null,
          // The change feed pushes a calendar-origin edit; a system or publer
          // origin would be skipped as an echo of Publer's own state.
          syncOrigin: 'calendar',
          syncStatus: publerPostIds.length ? 'pending' : existing.syncStatus || 'pending',
        });
        return json(200, {
          success: true,
          item: updated,
          publer: publerPostIds.length
            ? { push: 'change-feed', postIds: publerPostIds }
            : {
                push: 'next-sync',
                reason: 'Publer has not reported post ids for this record yet',
              },
        });
      } catch (error) {
        context.error('patchSocialPost failed:', error);
        return json(500, { error: 'Failed to update social post' });
      }
    },

    /** DELETE /api/cms/social-posts/{id} */
    async deleteSocialPost(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        // The `!after` branch of Site-Main's syncSocialPostToPubler: the change
        // feed never delivers a delete, so the Publer un-publish happens here
        // (T-324). Best-effort, before the document goes.
        let publer = { attempted: 0, removed: 0 };
        if (unpublishSocialPost) {
          const existing = await store.readDoc('social_posts', id, id);
          if (existing) publer = await unpublishSocialPost(existing);
        }
        await store.deleteDoc('social_posts', id);
        return json(200, { success: true, publer });
      } catch (error) {
        context.error('deleteSocialPost failed:', error);
        return json(500, { error: 'Failed to delete social post' });
      }
    },
  };
}
