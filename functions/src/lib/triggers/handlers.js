/**
 * handlers.js — what each change-feed function does with a batch of changed
 * documents. One handler per container (the feed delivers a container's
 * changes in order; one lease processor per container instead of one per
 * former Firestore trigger):
 *
 *   speakerevents  → mirror eventImageUrl
 *   certifications → mirror imageUrl
 *   blogs          → mirror contentImageUrl, else template cover; slug page on createSlugPageTrigger
 *   content        → inspect on inspectTrigger; AI cover on altCoverImageTrigger; dashboard counters
 *   workflow_alerts→ Telegram on activation
 *   social_posts   → push calendar edits to Publer
 *
 * Every handler swallows per-document errors (logged) so one bad document
 * never stalls the lease behind it. Each decides from the document it is
 * given plus live state — the feed carries the current item only, and the
 * value markers / rising-edge claims / stats markers replace `before`.
 * `_etag` of the delivered item is the "event id" a rising-edge claim records:
 * stable across redeliveries of the same write, different for a new write.
 */
import { claimRisingEdge, releaseRisingEdgeClaim } from './rising-edge-claim.js';
import { evaluateActivationNotice, ACTIVATION_NOTIFIED_FIELD } from './activation-notice.js';
import { markerForFields, shouldProcessValue } from './value-marker.js';
import { generateSlug } from '../rss/feeds.js';

export const SLUG_PAGE_CLAIM_FIELDS = Object.freeze({
  flagField: 'createSlugPageTrigger',
  claimField: 'createSlugPageRunId',
  claimedAtField: 'createSlugPageRunAt',
});

export const SOCIAL_POST_SYNC_FIELDS = ['caption', 'url', 'scheduledAt', 'accountIds', 'platforms'];

export function buildPublerUpdateBody(socialPost = {}) {
  const text = [socialPost.caption, socialPost.url].filter(Boolean).join('\n\n').trim();
  if (!text)
    throw new Error('A social post must have caption or URL text before syncing to Publer');
  const post = { text };
  if (socialPost.scheduledAt) {
    const date = new Date(socialPost.scheduledAt);
    if (!Number.isNaN(date.getTime())) post.scheduled_at = date.toISOString();
  }
  return { post };
}

const eventIdOf = (doc) => doc?._etag || doc?._ts?.toString() || 'unknown';

async function each(docs, context, label, fn) {
  const results = [];
  for (const doc of docs || []) {
    if (!doc?.id) continue;
    try {
      results.push(await fn(doc));
    } catch (err) {
      context.error?.(`[${label}] ${doc.id}: ${err?.message || err}`);
      results.push({ id: doc.id, error: err?.message || String(err) });
    }
  }
  return results;
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, replaceDocIfMatch: Function, deleteDoc: Function }} deps.store
 * @param {{ mirror: Function, generateTemplateCover: Function }} deps.mirror
 * @param {{ executeInspection: Function }} deps.inspector
 * @param {{ run: Function }} deps.aiCover
 * @param {{ applyTransition: Function }} deps.dashboardStats
 * @param {{ notifyTelegram: Function }} deps.notifier
 * @param {{ configured: boolean, request: Function }} deps.publer
 * @param {() => Date} [deps.now]
 */
export function createFeedHandlers({
  store,
  mirror,
  inspector,
  aiCover,
  dashboardStats,
  notifier,
  publer,
  now = () => new Date(),
}) {
  const speakerevents = (docs, context) =>
    each(docs, context, 'feed:speakerevents', (doc) => mirror.mirror('speakerevents', doc));
  const certifications = (docs, context) =>
    each(docs, context, 'feed:certifications', (doc) => mirror.mirror('certifications', doc));

  const blogs = (docs, context) =>
    each(docs, context, 'feed:blogs', async (doc) => {
      const mirrored = await mirror.mirror('blogs', doc);
      const cover = mirrored.mirrored
        ? { generated: false, reason: 'mirrored' }
        : await mirror.generateTemplateCover(doc);
      const slug = await createSlugPage(doc);
      return { id: doc.id, mirrored: mirrored.reason, cover: cover.reason, slug: slug.reason };
    });

  /** The curated slug-page fields, claimed once per `createSlugPageTrigger` request. */
  async function createSlugPage(doc) {
    const claim = await claimRisingEdge(store, 'blogs', doc.id, {
      ...SLUG_PAGE_CLAIM_FIELDS,
      eventId: eventIdOf(doc),
      now,
    });
    if (!claim.claim) return { created: false, reason: claim.reason };
    const data = claim.data;
    const rawTitle = data.Title || data.title || 'untitled-article';
    const provider = String(
      data.landingProvider || data.cloudProvider || data['Cloud Provider'] || 'azure'
    ).toLowerCase();
    const baseSlug = generateSlug(rawTitle) || `article-${doc.id.slice(0, 6)}`;
    const slug = data.slug || data.Slug || `${baseSlug}-${doc.id.slice(0, 6)}`;
    await store.patchDoc('blogs', doc.id, {
      ...releaseRisingEdgeClaim(SLUG_PAGE_CLAIM_FIELDS),
      slug,
      Slug: slug,
      createSlugPageTrigger: false,
      curatedParent: data.curatedParent || 'Curated Articles',
      curatedSubpage: true,
      curatedSubpagePath: `/${provider}/blog/${slug}`,
      curatedLinkedAt: now().toISOString(),
    });
    return { created: true, reason: 'created', slug };
  }

  const content = (docs, context) =>
    each(docs, context, 'feed:content', async (doc) => {
      const out = { id: doc.id };
      if (doc.inspectTrigger === true) {
        try {
          const r = await inspector.executeInspection({
            collectionName: 'content',
            docId: doc.id,
            newData: doc,
          });
          out.inspected = r.contentStatus;
        } catch (err) {
          context.error?.(`[inspect:content] ${doc.id}: ${err?.message || err}`);
          await store.patchDoc('content', doc.id, {
            inspectTrigger: false,
            inspectError: String(err?.message || err).slice(0, 2000),
            inspectErrorAt: now().toISOString(),
          });
          out.inspected = 'error';
        }
      }
      if (doc.altCoverImageTrigger === true) {
        const r = await aiCover.run(doc.id, eventIdOf(doc));
        out.aiCover = r.reason;
      }
      // Counters last, from the document as delivered; a claim or completion
      // write above re-delivers this document and the marker then matches.
      const deltas = await dashboardStats.applyTransition({ contentId: doc.id, afterData: doc });
      out.statsMoved = Object.keys(deltas).length > 0;
      return out;
    });

  const workflowAlerts = (docs, context) =>
    each(docs, context, 'feed:workflow_alerts', async (doc) => {
      if (!evaluateActivationNotice(doc).send)
        return { id: doc.id, sent: false, reason: 'snapshot' };
      const live = await store.readDoc('workflow_alerts', doc.id, doc.id);
      const decision = evaluateActivationNotice(live);
      if (!decision.send) return { id: doc.id, sent: false, reason: decision.reason };
      const omit = new Set([
        'id',
        'firstSeenAt',
        'updatedAt',
        'active',
        'alertType',
        'source',
        ACTIVATION_NOTIFIED_FIELD,
        '_rid',
        '_self',
        '_etag',
        '_attachments',
        '_ts',
      ]);
      const result = await notifier.notifyTelegram({
        title: `Workflow alert: ${live.alertType || 'unknown'}`,
        message: JSON.stringify(
          Object.fromEntries(Object.entries(live).filter(([key]) => !omit.has(key))),
          null,
          2
        ),
        severity: live.severity || 'warning',
        source: live.source || 'workflow_alerts',
      });
      // Stamped only after the send succeeded; a not-configured notifier leaves
      // the alert unannounced so it announces once Telegram is configured.
      if (result.sent)
        await store.patchDoc('workflow_alerts', doc.id, {
          [ACTIVATION_NOTIFIED_FIELD]: now().toISOString(),
        });
      return { id: doc.id, sent: result.sent, reason: result.reason || 'sent' };
    });

  const socialPosts = (docs, context) =>
    each(docs, context, 'feed:social_posts', async (doc) => {
      const publerPostIds = Array.isArray(doc.publerPostIds) ? doc.publerPostIds : [];
      if (publerPostIds.length === 0) return { id: doc.id, pushed: false, reason: 'no_publer_ids' };
      if (doc.syncOrigin === 'publer' || doc.syncOrigin === 'system')
        return { id: doc.id, pushed: false, reason: `origin_${doc.syncOrigin}` };
      const marker = markerForFields(doc, SOCIAL_POST_SYNC_FIELDS);
      const decision = await shouldProcessValue({
        value: marker,
        snapshotMarker: doc.publerSyncedFieldsHash,
        readLiveMarker: async () =>
          (await store.readDoc('social_posts', doc.id, doc.id))?.publerSyncedFieldsHash,
      });
      if (!decision.process) return { id: doc.id, pushed: false, reason: decision.reason };
      if (!publer.configured) return { id: doc.id, pushed: false, reason: 'publer_not_configured' };
      try {
        const activeIds = Array.isArray(doc.publerActivePostIds)
          ? doc.publerActivePostIds
          : publerPostIds;
        const body = buildPublerUpdateBody(doc);
        await Promise.all(activeIds.map((id) => publer.request(`/posts/${id}`, 'PUT', body)));
        await store.patchDoc('social_posts', doc.id, {
          publerSyncedFieldsHash: marker,
          syncStatus: 'synced',
          syncOrigin: 'calendar',
          lastSyncedAt: now().toISOString(),
          syncError: null,
        });
        return { id: doc.id, pushed: true, reason: 'pushed' };
      } catch (err) {
        context.error?.(`[syncSocialPostToPubler] ${doc.id}: ${err?.message || err}`);
        await store.patchDoc('social_posts', doc.id, {
          syncStatus: 'failed',
          syncOrigin: 'system',
          syncError: String(err?.message || err).slice(0, 500),
          lastSyncAttemptAt: now().toISOString(),
        });
        return { id: doc.id, pushed: false, reason: 'error' };
      }
    });

  return {
    speakerevents,
    certifications,
    blogs,
    content,
    workflowAlerts,
    socialPosts,
    createSlugPage,
  };
}

/**
 * The `!after` branch of syncSocialPostToPubler: un-publish on Publer when a
 * social post is deleted. Called by DELETE /api/cms/social-posts/{id}.
 * Best-effort; never throws.
 */
export async function unpublishFromPubler(publer, doc, log = {}) {
  const ids = Array.isArray(doc?.publerPostIds) ? doc.publerPostIds : [];
  if (!ids.length || !publer?.configured) return { attempted: 0, removed: 0 };
  const results = await Promise.allSettled(
    ids.map((id) => publer.request(`/posts/${id}`, 'DELETE'))
  );
  const removed = results.filter((r) => r.status === 'fulfilled').length;
  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => log.warn?.(`[unpublishFromPubler] ${r.reason?.message || r.reason}`));
  return { attempted: ids.length, removed };
}
