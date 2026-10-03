/**
 * Content CRUD handler logic, ported from Site-Main cms-functions.js.
 *
 * Source semantics preserved (listContentItems :6622, getContentItem :3278):
 *   - list: optional contentStatus filter, limit clamped to 100 (default 25),
 *     NO ordering by default — the source query has no orderBy, and adding
 *     one would change which items appear under the limit. `?sort=` opts a
 *     caller in (LIST_SORT_FIELDS): Live Pages asks for `publishedAt`, which
 *     every published document carries, so the 500 newest live pages come
 *     back rather than 500 arbitrary documents (ADR 0033 §1).
 *   - `?kind=` and `?ideaOrigin=` (ADR 0033 §4) match the stored field OR,
 *     for a record that predates the taxonomy, the value its `type` /
 *     `source` derives to — so the filter agrees with the chip the list shows.
 *   - list returns the admin snapshot PROJECTION, not whole documents. Content
 *     bodies (postContent etc.) are large; the queue UI reads only these
 *     fields. Firestore `.select(...)` becomes a Cosmos SELECT projection.
 *   - get: accepts contentId via GET query or POST body, exactly as the
 *     source does; 400 without it, 404 when absent.
 *
 * Auth is the two-gate role guard (lib/auth/require-role.js), replacing the
 * stub-era requireAdminClaims middleware whose audience config (ENTRA_CLIENT_ID)
 * no longer exists in the infrastructure.
 */

import {
  derivedKindTypes,
  derivedOriginSources,
} from "./cms/taxonomy-fields.js";

/**
 * Ported verbatim from Site-Main cms-functions.js:2211
 * (ADMIN_CONTENT_SNAPSHOT_FIELDS). The duplicate casings and spaced names
 * ('CD Url', 'Created At', 'Published At', 'Cover Image') are real field names
 * written by different ingestion paths — project all of them or the queue UI
 * shows "Not provided" for data that exists.
 */
export const ADMIN_CONTENT_SNAPSHOT_FIELDS = [
  "Title",
  "title",
  "Summary",
  "summary",
  "sourceUrl",
  "sourceUrls",
  "sourceFeed",
  "CD Url",
  "type",
  "contentType",
  "publishTarget",
  "targetLandingZone",
  "Cloud Provider",
  "cloudProvider",
  "contentStatus",
  "Live",
  "fetchedAt",
  "createdAt",
  "Created At",
  "updatedAt",
  "reviewedAt",
  "publishedAt",
  "Published At",
  "publishedDate",
  "datePublished",
  "pubDate",
  "keyTopics",
  "Tags",
  "aiTags",
  "forgeGrade",
  "forgeMeta",
  "slug",
  "Slug",
  "category",
  "wordCount",
  "readTime",
  "source",
  "altCoverImage",
  "coverImage",
  "Cover Image",
  "heroImageUrl",
  "contentImageUrl",
  "secondaryImageUrls",
  "aiImageUrls",
  "slugPageUrl",
  "publishedUrl",
  "publicUrl",
  "curatedSubpagePath",
  "format",
  // Workflow-page fields (EditorList/LivePages/Calendar/Published read these
  // from list rows; they came for free when the pages fetched whole docs):
  "Status",
  "scheduledPublishDate",
  "softDeletedAt",
  "softDeleteExpiresAt",
  "archivedAt",
  "blogEditedAt",
  "blogPublishedAt",
  "blogUrl",
  "publishedContentId",
  "sourceContentId",
  "provider",
  "critiqueVerdict",
  "critiqueGenericityScore",
  "critiqueSpecificityScore",
  "critiqueIssues",
  "draftRevised",
  // Taxonomy (ADR 0033 §4): what the item becomes, how it became an idea.
  "kind",
  "ideaOrigin",
];

export const LIST_DEFAULT_LIMIT = 25;
// 500 matches the workflow pages' fetch windows (EditorList/LivePages/
// Calendar asked Firestore for 500-doc windows); RPC callers pass no limit
// and keep the source default of 25.
export const LIST_MAX_LIMIT = 500;

/** `c["Cover Image"]` quoting handles the spaced/cased field names. */
const PROJECTION = [
  "c.id",
  ...ADMIN_CONTENT_SNAPSHOT_FIELDS.map((f) => `c["${f}"]`),
].join(", ");

/**
 * The fields a caller may order by, newest first. Each is a timestamp the
 * pipeline writes on the documents the caller is listing; a document missing
 * the field is excluded by Cosmos ORDER BY, which is why the default stays
 * unordered and the choice is the caller's.
 */
export const LIST_SORT_FIELDS = Object.freeze([
  "publishedAt",
  "updatedAt",
  "fetchedAt",
  "createdAt",
]);

/** The version rows a History dialog lists: everything but the body itself. */
const VERSION_LIST_PROJECTION = [
  "c.id",
  "c.contentId",
  "c.title",
  "c.summary",
  "c.versionCreatedAt",
  "c.versionCreatedBy",
  "c.versionReason",
  "c.updatedFields",
  "c.tags",
  "c.authorName",
  "c.publishedDate",
  "LENGTH(c.draft) AS draftChars",
].join(", ");
export const VERSIONS_LIST_LIMIT = 50;

/** `kind` filter: stored, or derived from `type` when nothing is stored. */
export function kindFilterClause(kind, parameters) {
  const types = derivedKindTypes(kind);
  parameters.push({ name: "@kind", value: kind });
  if (types.length === 0) return "c.kind = @kind";
  parameters.push({ name: "@kindTypes", value: types });
  return (
    '(c.kind = @kind OR ((NOT IS_DEFINED(c.kind) OR c.kind = null OR c.kind = "") ' +
    "AND ARRAY_CONTAINS(@kindTypes, LOWER(c.type))))"
  );
}

/** `ideaOrigin` filter: stored, or derived from `source` when nothing is stored. */
export function ideaOriginFilterClause(ideaOrigin, parameters) {
  const { sources, includesUnknownSource, knownSources } =
    derivedOriginSources(ideaOrigin);
  parameters.push({ name: "@ideaOrigin", value: ideaOrigin });
  const unset =
    '(NOT IS_DEFINED(c.ideaOrigin) OR c.ideaOrigin = null OR c.ideaOrigin = "")';
  const derived = [];
  if (sources.length) {
    parameters.push({ name: "@originSources", value: sources });
    derived.push("ARRAY_CONTAINS(@originSources, c.source)");
  }
  if (includesUnknownSource) {
    parameters.push({ name: "@knownSources", value: knownSources });
    derived.push("NOT ARRAY_CONTAINS(@knownSources, c.source)");
  }
  if (derived.length === 0) return "c.ideaOrigin = @ideaOrigin";
  return `(c.ideaOrigin = @ideaOrigin OR (${unset} AND (${derived.join(" OR ")})))`;
}

const json = (status, body) => ({
  status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard role guard (default-guard.js in prod)
 * @param {{ queryDocs: Function, readDoc: Function, deleteDoc: Function }} deps.store
 */
export function createCmsContentHandlers({
  guard,
  store,
  onContentDeleted = null,
}) {
  return {
    /**
     * GET /api/cms/content — source: listContentItems.
     * status accepts a comma-separated list (the workflow pages query
     * multi-status windows); live=true filters to c.Live = true; type
     * filters case-insensitively (Frameworks/CoderCorner boards); kind and
     * ideaOrigin filter on the taxonomy (stored or derived); sort orders by
     * one of LIST_SORT_FIELDS, newest first.
     */
    async list(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;

      try {
        const statusParam = String(request.query.get("status") || "").trim();
        const statuses = statusParam
          ? statusParam
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const liveOnly = request.query.get("live") === "true";
        const type = String(request.query.get("type") || "")
          .trim()
          .toLowerCase();
        const kind = String(request.query.get("kind") || "")
          .trim()
          .toLowerCase();
        const ideaOrigin = String(request.query.get("ideaOrigin") || "")
          .trim()
          .toLowerCase();
        const sort = String(request.query.get("sort") || "").trim();
        if (sort && !LIST_SORT_FIELDS.includes(sort)) {
          return json(400, {
            error: `sort must be one of: ${LIST_SORT_FIELDS.join(", ")}`,
          });
        }
        // `?limit=abc` produced `TOP NaN` (a 500 carrying raw Cosmos error
        // text) and `?limit=0` produced `TOP 0` (a silently empty list). Same
        // clamp the four sibling handlers use (T-310).
        const max = Math.min(
          Math.max(Number(request.query.get("limit")) || LIST_DEFAULT_LIMIT, 1),
          LIST_MAX_LIMIT,
        );

        let query = `SELECT TOP @limit ${PROJECTION} FROM c`;
        const parameters = [{ name: "@limit", value: max }];
        const clauses = [];
        if (statuses.length === 1) {
          clauses.push("c.contentStatus = @status");
          parameters.push({ name: "@status", value: statuses[0] });
        } else if (statuses.length > 1) {
          clauses.push("ARRAY_CONTAINS(@statuses, c.contentStatus)");
          parameters.push({ name: "@statuses", value: statuses });
        }
        if (liveOnly) {
          clauses.push("c.Live = true");
        }
        if (type) {
          clauses.push("LOWER(c.type) = @type");
          parameters.push({ name: "@type", value: type });
        }
        if (kind) clauses.push(kindFilterClause(kind, parameters));
        if (ideaOrigin)
          clauses.push(ideaOriginFilterClause(ideaOrigin, parameters));
        if (clauses.length > 0) query += ` WHERE ${clauses.join(" AND ")}`;
        if (sort) query += ` ORDER BY c["${sort}"] DESC`;

        const items = await store.queryDocs("content", query, parameters);
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error("listContentItems failed:", error);
        // No error.message to the client: it is raw Cosmos text on this path
        // and can carry query structure. The context.error above keeps it.
        return json(500, { error: "Failed to list content items" });
      }
    },

    /** GET|POST /api/cms/content/item — source: getContentItem */
    async get(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;

      let contentId;
      if (String(request.method).toUpperCase() === "GET") {
        contentId = request.query.get("contentId");
      } else {
        const body = await request.json().catch(() => null);
        contentId = body?.contentId;
      }
      if (!contentId) return json(400, { error: "contentId required" });

      try {
        const item = await store.readDoc("content", contentId, contentId);
        if (!item)
          return json(404, { error: `content ${contentId} not found` });
        return json(200, { success: true, item });
      } catch (error) {
        context.error("getContentItem failed:", error);
        return json(500, { error: "Failed to get content item" });
      }
    },

    /**
     * GET /api/cms/content/{id}/versions — the saved versions of one record,
     * newest first, without bodies (ADR 0033 §1: content_versions was written
     * on every save and read by nothing). Editor role: the same role that
     * writes them.
     */
    async listVersions(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;
      const contentId = request.params?.id;
      if (!contentId) return json(400, { error: "id required" });
      try {
        const versions = await store.queryDocs(
          "content_versions",
          `SELECT TOP ${VERSIONS_LIST_LIMIT} ${VERSION_LIST_PROJECTION} FROM c WHERE c.contentId = @contentId ORDER BY c.versionCreatedAt DESC`,
          [{ name: "@contentId", value: contentId }],
        );
        return json(200, {
          success: true,
          contentId,
          versions,
          limit: VERSIONS_LIST_LIMIT,
        });
      } catch (error) {
        context.error("listContentVersions failed:", error);
        return json(500, { error: "Failed to list content versions" });
      }
    },

    /** GET /api/cms/content/{id}/versions/{versionId} — one version, body included. */
    async getVersion(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;
      const contentId = request.params?.id;
      const versionId = request.params?.versionId;
      if (!contentId || !versionId)
        return json(400, { error: "id and versionId required" });
      try {
        // Partitioned by /contentId (the manifest's one non-/id container).
        const version = await store.readDoc(
          "content_versions",
          versionId,
          contentId,
        );
        if (!version || version.contentId !== contentId) {
          return json(404, { error: `version ${versionId} not found` });
        }
        return json(200, { success: true, version });
      } catch (error) {
        context.error("getContentVersion failed:", error);
        return json(500, { error: "Failed to read content version" });
      }
    },

    // Creation lives in cms/content-create.js (full source semantics: dedup,
    // quality gate). The interim raw-upsert `save` placeholder is retired —
    // a validation-free write path must not coexist with the real one.

    /** DELETE /api/cms/content/{id} — blob cleanup still pending, as before. */
    async remove(request, context) {
      const auth = await guard.requireRole(request, "editor");
      if (auth.error) return auth.error;

      try {
        const id = request.params.id;
        if (!id) return json(400, { error: "id required" });
        await store.deleteDoc("content", id);
        // The change feed never delivers a delete (T-324): the dashboard
        // counters are moved here, best-effort.
        if (onContentDeleted) {
          await onContentDeleted(id).catch((err) =>
            context.warn?.(
              `cmsDeleteContent: counters not updated for ${id}: ${err?.message}`,
            ),
          );
        }
        return json(200, { success: true });
      } catch (error) {
        context.error("cmsDeleteContent failed:", error);
        return json(500, { error: "Failed to delete content" });
      }
    },
  };
}
