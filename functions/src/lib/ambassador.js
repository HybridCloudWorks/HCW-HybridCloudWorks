/**
 * Ambassador — programs, applications, evidence and readiness (ADR 0033 §4,
 * the Spotlight slice). One Cosmos container, `ambassador`, partitioned on
 * `/id`, with three document kinds told apart by `docType`:
 *
 *   program      a community program (Microsoft MVP, AWS Hero, …) with its
 *                requirements[]; seeded on first read, editable, disable-able
 *   application  one pursuit of one program, with a status machine, the
 *                responses, files, decision dates and a history of every
 *                status change; private by default and never published
 *   evidence     one thing that happened (a talk, a cert, an article) that an
 *                application can point at, linked to its source module by
 *                {sourceModule, sourceId} and carrying a snapshot of what the
 *                source said at link time
 *
 * Everything here exists to culminate in a credible application, which is
 * why readiness explains how it was computed and never promises acceptance:
 * the programs decide, and their published criteria change.
 *
 * Soft deletes everywhere (`softDeletedAt`); audit rows to admin_audit_logs
 * in the shape admin-crud.js writes. Roles: editor reads and writes,
 * publisher deletes, super_admin changes program settings (roles.js).
 *
 * UNTIL `terraform apply` CREATES THE CONTAINER the API answers 503
 * `{ code: 'NOT_PROVISIONED' }` (ADR 0033 §6 item 4) and nothing else
 * breaks; the hub renders that state with the owner's plan command.
 */
import { randomUUID } from 'node:crypto';

export const CONTAINER = 'ambassador';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_DOC_JSON = 200_000;
const LIST_WINDOW = 2000;

export const NOT_PROVISIONED = Object.freeze({
  code: 'NOT_PROVISIONED',
  message: 'Run terraform apply for the ambassador container',
});

export const APPLICATION_STATUSES = Object.freeze([
  'interested',
  'preparing',
  'ready',
  'submitted',
  'under_review',
  'accepted',
  'active',
  'renewal_due',
  'renewed',
  'denied',
  'expired',
  'withdrawn',
]);

/**
 * Allowed status moves. Forward through the funnel, back one step while
 * still preparing, out to withdrawn from anywhere before a decision, and a
 * terminal state can start over as a fresh pursuit for the next cycle.
 */
export const APPLICATION_TRANSITIONS = Object.freeze({
  interested: ['preparing', 'withdrawn'],
  preparing: ['ready', 'interested', 'withdrawn'],
  ready: ['submitted', 'preparing', 'withdrawn'],
  submitted: ['under_review', 'accepted', 'denied', 'withdrawn'],
  under_review: ['accepted', 'denied', 'withdrawn'],
  accepted: ['active', 'expired'],
  active: ['renewal_due', 'expired', 'withdrawn'],
  renewal_due: ['renewed', 'expired', 'denied', 'withdrawn'],
  renewed: ['active', 'renewal_due', 'expired'],
  denied: ['interested', 'preparing'],
  expired: ['interested', 'preparing'],
  withdrawn: ['interested', 'preparing'],
});

export function canTransition(from, to) {
  return Array.isArray(APPLICATION_TRANSITIONS[from]) && APPLICATION_TRANSITIONS[from].includes(to);
}

export const EVIDENCE_SOURCES = Object.freeze([
  'speaking',
  'certifications',
  'content',
  'listen-and-learn',
  'labs',
  'newsletter',
  'manual',
]);

export const VERIFICATION_STATUSES = Object.freeze(['unverified', 'verified']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` naming a real day, or null. A full ISO timestamp keeps its day. */
export function toCalendarDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const head = text.slice(0, 10);
  if (!ISO_DATE.test(head)) return null;
  const [y, m, d] = head.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms).toISOString().slice(0, 10) === head ? head : null;
}

export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Seed programs ─────────────────────────────────────────────────────────────

const EDIT_NOTE = 'Edit to match the current program rules.';

const requirement = (id, label, description, evidenceTypes, minCount, weight) => ({
  id,
  label,
  description,
  evidenceTypes,
  minCount,
  weight,
});

/**
 * Seven defaults, materialised on the first read of an empty container. Every
 * field is editable afterwards; the requirements are sensible starting points
 * and say so, because each program publishes its own rules and changes them.
 */
export const DEFAULT_PROGRAMS = Object.freeze([
  {
    id: 'program-microsoft-mvp',
    name: 'Microsoft MVP',
    provider: 'Microsoft',
    category: 'community-expert',
    description:
      'Microsoft Most Valuable Professional: recognises exceptional technical community leadership over the previous twelve months. Nomination by a Microsoft employee or an existing MVP.',
    applicationUrl: 'https://mvp.microsoft.com/',
    eligibility: [
      'Nominated by a Microsoft full-time employee or a current MVP',
      'Community contributions in the twelve months before review',
      'Not a Microsoft employee',
    ],
    criteria: ['Impact', 'Quality', 'Breadth', 'Technical expertise'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Rolling nominations; reviewed monthly.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Award year runs 1 July to 30 June; renewal reviews the prior year.',
    requirements: [
      requirement(
        'talks',
        'Speaking engagements',
        `Sessions delivered at conferences, user groups or online events. ${EDIT_NOTE}`,
        ['speaking'],
        4,
        3
      ),
      requirement(
        'articles',
        'Published content',
        `Articles, tutorials or documentation published publicly. ${EDIT_NOTE}`,
        ['content', 'newsletter'],
        6,
        3
      ),
      requirement(
        'depth',
        'Technical depth',
        `Certifications or labs that evidence depth in the award category. ${EDIT_NOTE}`,
        ['certifications', 'labs'],
        1,
        1
      ),
      requirement(
        'reach',
        'Audio and video',
        `Podcast episodes, recordings or Listen & Learn chapters. ${EDIT_NOTE}`,
        ['listen-and-learn'],
        2,
        1
      ),
    ],
    recommendedActivities: [
      'Speak at two or more community events a quarter',
      'Publish one article a month on the award technology',
      'Keep every contribution dated and linked',
    ],
  },
  {
    id: 'program-microsoft-mct',
    name: 'Microsoft Certified Trainer',
    provider: 'Microsoft',
    category: 'training',
    description:
      'MCT: the premier technical and instructional experts on Microsoft technologies. Requires a qualifying certification and instructional experience.',
    applicationUrl: 'https://learn.microsoft.com/credentials/certifications/mct-certification',
    eligibility: [
      'Hold at least one qualifying Microsoft certification',
      'Demonstrate instructional skills (certification or verified experience)',
      'Pay the annual program fee',
    ],
    criteria: ['Qualifying certification', 'Instructional competence'],
    applicationWindow: { opens: null, closes: null, note: 'Apply any time; renew annually.' },
    renewalCadence: 'annual',
    expirationRule: 'Expires one year from enrolment unless renewed.',
    requirements: [
      requirement(
        'cert',
        'Qualifying certification',
        `An active, qualifying Microsoft certification. ${EDIT_NOTE}`,
        ['certifications'],
        1,
        4
      ),
      requirement(
        'teaching',
        'Instructional evidence',
        `Delivered training, workshops or sessions. ${EDIT_NOTE}`,
        ['speaking', 'listen-and-learn'],
        2,
        2
      ),
    ],
    recommendedActivities: [
      'Renew the qualifying certification before it lapses',
      'Record delivered workshops as evidence',
    ],
  },
  {
    id: 'program-aws-community-hero',
    name: 'AWS Community Hero',
    provider: 'AWS',
    category: 'community-expert',
    description:
      'AWS Heroes: recognises individuals with an outsized impact on the AWS community through content, speaking and mentorship. By invitation.',
    applicationUrl: 'https://aws.amazon.com/developer/community/heroes/',
    eligibility: [
      'Sustained AWS community contributions',
      'Nominated by AWS or an existing Hero',
      'Not an AWS employee',
    ],
    criteria: ['Community impact', 'Consistency', 'Expertise'],
    applicationWindow: { opens: null, closes: null, note: 'Invitation only; no open application.' },
    renewalCadence: 'ongoing',
    expirationRule: 'Reviewed on an ongoing basis.',
    requirements: [
      requirement('talks', 'AWS talks', `Sessions on AWS topics. ${EDIT_NOTE}`, ['speaking'], 4, 3),
      requirement(
        'content',
        'AWS content',
        `Articles and tutorials on AWS. ${EDIT_NOTE}`,
        ['content', 'newsletter'],
        6,
        3
      ),
      requirement(
        'certs',
        'AWS certifications',
        `Active AWS certifications. ${EDIT_NOTE}`,
        ['certifications'],
        2,
        1
      ),
    ],
    recommendedActivities: [
      'Lead or speak at an AWS user group',
      'Publish re:Invent recap and deep-dive content',
    ],
  },
  {
    id: 'program-aws-ambassador',
    name: 'AWS Ambassador',
    provider: 'AWS',
    category: 'partner',
    description:
      'AWS Ambassador Program: for technical experts at AWS Partner Network organisations who share AWS knowledge publicly.',
    applicationUrl: 'https://aws.amazon.com/partners/ambassadors/',
    eligibility: [
      'Employed by an AWS Partner Network organisation',
      'Hold AWS Professional or Specialty certifications',
      'Public AWS content and speaking',
    ],
    criteria: ['Certifications', 'Public contributions', 'Partner standing'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Rolling, through the partner organisation.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Annual requalification against the published point thresholds.',
    requirements: [
      requirement(
        'certs',
        'Professional or Specialty certifications',
        `Active AWS Professional or Specialty certifications. ${EDIT_NOTE}`,
        ['certifications'],
        2,
        3
      ),
      requirement('talks', 'Public speaking', `Sessions on AWS. ${EDIT_NOTE}`, ['speaking'], 2, 2),
      requirement(
        'content',
        'Public content',
        `Articles, blogs, open source or videos. ${EDIT_NOTE}`,
        ['content', 'newsletter', 'listen-and-learn'],
        4,
        2
      ),
    ],
    recommendedActivities: [
      'Track the annual point total against the current thresholds',
      'Renew certifications ahead of the requalification date',
    ],
  },
  {
    id: 'program-github-star',
    name: 'GitHub Star',
    provider: 'GitHub',
    category: 'community-expert',
    description:
      'GitHub Stars: recognises developers who inspire and educate the community, through open source, content and events. Nomination based.',
    applicationUrl: 'https://stars.github.com/',
    eligibility: [
      'Nominated through the GitHub Stars site',
      'Public, sustained community contribution',
      'Not a GitHub or Microsoft employee',
    ],
    criteria: ['Inspiration', 'Education', 'Open source leadership'],
    applicationWindow: { opens: null, closes: null, note: 'Nominations open year-round.' },
    renewalCadence: 'annual',
    expirationRule: 'Reviewed annually.',
    requirements: [
      requirement(
        'content',
        'Educational content',
        `Articles, videos or courses on GitHub and developer workflow. ${EDIT_NOTE}`,
        ['content', 'listen-and-learn', 'newsletter'],
        6,
        3
      ),
      requirement(
        'talks',
        'Community talks',
        `Sessions and workshops. ${EDIT_NOTE}`,
        ['speaking'],
        3,
        2
      ),
      requirement(
        'labs',
        'Open source and labs',
        `Repositories, labs and hands-on material. ${EDIT_NOTE}`,
        ['labs', 'manual'],
        2,
        2
      ),
    ],
    recommendedActivities: [
      'Maintain public repositories with clear READMEs',
      'Publish GitHub Actions and Copilot walkthroughs',
    ],
  },
  {
    id: 'program-docker-captain',
    name: 'Docker Captain',
    provider: 'Docker',
    category: 'community-expert',
    description:
      'Docker Captains: technology experts and leaders in the Docker community who share their knowledge. Selected by Docker.',
    applicationUrl: 'https://www.docker.com/community/captains/',
    eligibility: [
      'Demonstrated Docker expertise',
      'Regular public Docker content or speaking',
      'Not a Docker employee',
    ],
    criteria: ['Expertise', 'Community sharing', 'Consistency'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Selection by Docker; express interest through the program page.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Reviewed annually.',
    requirements: [
      requirement(
        'content',
        'Docker content',
        `Articles and guides on Docker. ${EDIT_NOTE}`,
        ['content', 'newsletter'],
        4,
        3
      ),
      requirement(
        'talks',
        'Docker talks',
        `Sessions on containers and Docker. ${EDIT_NOTE}`,
        ['speaking'],
        2,
        2
      ),
      requirement(
        'labs',
        'Hands-on material',
        `Labs, repositories, Compose examples. ${EDIT_NOTE}`,
        ['labs', 'manual'],
        2,
        1
      ),
    ],
    recommendedActivities: [
      'Publish Docker Desktop and image-building guides',
      'Speak at a Docker community event',
    ],
  },
  {
    id: 'program-vmware-vexpert',
    name: 'VMware vExpert',
    provider: 'Broadcom (VMware)',
    category: 'community-expert',
    description:
      'vExpert: recognises VMware community contributors — bloggers, speakers, book authors and community leaders — through an annual application.',
    applicationUrl: 'https://vexpert.vmware.com/',
    eligibility: [
      'Public VMware community contributions in the prior year',
      'Application in the annual window',
      'Any employer',
    ],
    criteria: ['Evangelist path', 'Customer path', 'Partner path'],
    applicationWindow: {
      opens: null,
      closes: null,
      note: 'Annual window, usually opening in the first quarter.',
    },
    renewalCadence: 'annual',
    expirationRule: 'Calendar-year award; apply again each cycle.',
    requirements: [
      requirement(
        'content',
        'VMware content',
        `Blog posts, podcasts and videos on VMware. ${EDIT_NOTE}`,
        ['content', 'listen-and-learn', 'newsletter'],
        6,
        3
      ),
      requirement(
        'talks',
        'VMware talks',
        `VMUG and conference sessions. ${EDIT_NOTE}`,
        ['speaking'],
        2,
        2
      ),
      requirement(
        'certs',
        'VMware certifications',
        `Active VMware certifications. ${EDIT_NOTE}`,
        ['certifications'],
        1,
        1
      ),
    ],
    recommendedActivities: [
      'Apply in the annual window',
      'Keep a dated log of VMUG sessions and posts',
    ],
  },
]);

// ── Validation ────────────────────────────────────────────────────────────────

const str = (value, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const optionalStr = (value, max) =>
  value === null || value === undefined ? null : str(value, max) || null;
const stringList = (value, max = 50) =>
  Array.isArray(value)
    ? value
        .map((v) => str(v, 300))
        .filter(Boolean)
        .slice(0, max)
    : [];

function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string')
        return isHttpUrl(item) ? { label: item, url: item.trim() } : null;
      if (!item || typeof item !== 'object') return null;
      const url = str(item.url, 2000);
      if (!isHttpUrl(url)) return null;
      return { label: str(item.label, 200) || url, url };
    })
    .filter(Boolean)
    .slice(0, 50);
}

function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const url = str(item.url, 2000);
      if (!url) return null;
      return {
        name: str(item.name, 300) || url.split('/').pop(),
        url,
        bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null,
        uploadedAt: item.uploadedAt ? String(item.uploadedAt) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function cleanPeriod(value) {
  if (!value || typeof value !== 'object') return null;
  const start = toCalendarDate(value.start);
  const end = toCalendarDate(value.end);
  if (!start && !end) return null;
  return { start, end };
}

function cleanRequirements(value) {
  if (!Array.isArray(value)) return { error: 'requirements must be an array' };
  const out = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object')
      return { error: `requirements[${index}] must be an object` };
    const id = str(item.id, 80) || `req-${index + 1}`;
    const label = str(item.label, 200);
    if (!label) return { error: `requirements[${index}].label is required` };
    const evidenceTypes = stringList(item.evidenceTypes).filter((t) =>
      EVIDENCE_SOURCES.includes(t)
    );
    const minCount = Math.max(0, Math.floor(Number(item.minCount) || 0));
    const weight = Math.max(0, Number(item.weight) || 0);
    out.push({
      id,
      label,
      description: str(item.description, 2000),
      evidenceTypes,
      minCount,
      weight,
    });
  }
  return { value: out };
}

const PROGRAM_FIELDS = new Set([
  'name',
  'provider',
  'description',
  'category',
  'applicationUrl',
  'eligibility',
  'criteria',
  'applicationWindow',
  'renewalCadence',
  'expirationRule',
  'requirements',
  'recommendedActivities',
  'enabled',
  'order',
  'evidenceTypes',
  'reminders',
  'customFields',
]);

/** A program patch with every field cleaned, or an error sentence. */
export function validateProgram(body, { partial = false } = {}) {
  const unknown = Object.keys(body).filter((k) => !PROGRAM_FIELDS.has(k));
  if (unknown.length) return { error: `Unknown program field(s): ${unknown.join(', ')}` };
  const out = {};
  if (!partial || 'name' in body) {
    out.name = str(body.name, 200);
    if (!out.name) return { error: 'name is required' };
  }
  if ('provider' in body) out.provider = str(body.provider, 200);
  if ('description' in body) out.description = str(body.description, 4000);
  if ('category' in body) out.category = str(body.category, 100);
  if ('applicationUrl' in body) {
    const url = optionalStr(body.applicationUrl, 2000);
    if (url && !isHttpUrl(url)) return { error: 'applicationUrl must be an http(s) URL' };
    out.applicationUrl = url;
  }
  for (const key of ['eligibility', 'criteria', 'recommendedActivities', 'evidenceTypes']) {
    if (key in body) out[key] = stringList(body[key]);
  }
  if ('applicationWindow' in body) {
    const w =
      body.applicationWindow && typeof body.applicationWindow === 'object'
        ? body.applicationWindow
        : {};
    out.applicationWindow = {
      opens: toCalendarDate(w.opens),
      closes: toCalendarDate(w.closes),
      note: str(w.note, 500),
    };
  }
  if ('renewalCadence' in body) out.renewalCadence = str(body.renewalCadence, 100);
  if ('expirationRule' in body) out.expirationRule = str(body.expirationRule, 1000);
  if ('requirements' in body) {
    const cleaned = cleanRequirements(body.requirements);
    if (cleaned.error) return cleaned;
    out.requirements = cleaned.value;
  }
  if ('enabled' in body) out.enabled = body.enabled !== false;
  if ('order' in body) out.order = Math.max(0, Math.floor(Number(body.order) || 0));
  if ('reminders' in body) {
    const r = body.reminders && typeof body.reminders === 'object' ? body.reminders : {};
    out.reminders = {
      daysBeforeDeadline: Math.max(0, Math.floor(Number(r.daysBeforeDeadline) || 0)),
      daysBeforeRenewal: Math.max(0, Math.floor(Number(r.daysBeforeRenewal) || 0)),
    };
  }
  if ('customFields' in body) {
    out.customFields = Array.isArray(body.customFields)
      ? body.customFields
          .map((f) =>
            f && typeof f === 'object'
              ? { id: str(f.id, 80), label: str(f.label, 200), type: str(f.type, 40) || 'text' }
              : null
          )
          .filter((f) => f && f.id && f.label)
          .slice(0, 50)
      : [];
  }
  return { value: out };
}

const APPLICATION_FIELDS = new Set([
  'programId',
  'title',
  'status',
  'statusNote',
  'qualificationPeriod',
  'applicationDate',
  'submissionDeadline',
  'decisionDate',
  'startDate',
  'expirationDate',
  'renewalDate',
  'notes',
  'reviewerFeedback',
  'responses',
  'files',
  'images',
  'links',
  'badgeImageUrl',
  'evidenceIds',
  'customValues',
  'private',
]);

const APPLICATION_DATE_FIELDS = [
  'applicationDate',
  'submissionDeadline',
  'decisionDate',
  'startDate',
  'expirationDate',
  'renewalDate',
];

/** An application patch with every field cleaned, or an error sentence. */
export function validateApplication(body, { partial = false } = {}) {
  const unknown = Object.keys(body).filter((k) => !APPLICATION_FIELDS.has(k));
  if (unknown.length) return { error: `Unknown application field(s): ${unknown.join(', ')}` };
  const out = {};
  if (!partial || 'programId' in body) {
    out.programId = str(body.programId, 120);
    if (!out.programId) return { error: 'programId is required' };
  }
  if ('title' in body) out.title = str(body.title, 300);
  if ('status' in body) {
    if (!APPLICATION_STATUSES.includes(body.status)) {
      return { error: `status must be one of ${APPLICATION_STATUSES.join(', ')}` };
    }
    out.status = body.status;
  }
  if ('statusNote' in body) out.statusNote = str(body.statusNote, 2000);
  if ('qualificationPeriod' in body)
    out.qualificationPeriod = cleanPeriod(body.qualificationPeriod);
  for (const key of APPLICATION_DATE_FIELDS) {
    if (!(key in body)) continue;
    if (body[key] === null || body[key] === '') {
      out[key] = null;
      continue;
    }
    const day = toCalendarDate(body[key]);
    if (!day) return { error: `${key} must be a YYYY-MM-DD date` };
    out[key] = day;
  }
  if ('notes' in body) out.notes = str(body.notes, 20000);
  if ('reviewerFeedback' in body) out.reviewerFeedback = str(body.reviewerFeedback, 20000);
  if ('responses' in body) {
    out.responses = Array.isArray(body.responses)
      ? body.responses
          .map((r) =>
            r && typeof r === 'object'
              ? { questionId: str(r.questionId, 120), text: str(r.text, 20000) }
              : null
          )
          .filter((r) => r && r.questionId)
          .slice(0, 100)
      : [];
  }
  if ('files' in body) out.files = cleanFiles(body.files);
  if ('images' in body) out.images = cleanFiles(body.images);
  if ('links' in body) out.links = cleanLinks(body.links);
  if ('badgeImageUrl' in body) {
    const url = optionalStr(body.badgeImageUrl, 2000);
    if (url && !isHttpUrl(url) && !url.startsWith('/'))
      return { error: 'badgeImageUrl must be an http(s) URL or a site path' };
    out.badgeImageUrl = url;
  }
  if ('evidenceIds' in body) out.evidenceIds = stringList(body.evidenceIds, 500);
  if ('customValues' in body) {
    out.customValues =
      body.customValues &&
      typeof body.customValues === 'object' &&
      !Array.isArray(body.customValues)
        ? Object.fromEntries(
            Object.entries(body.customValues)
              .slice(0, 50)
              .map(([k, v]) => [str(k, 80), str(v, 4000)])
          )
        : {};
  }
  if ('private' in body) out.private = body.private !== false;
  return { value: out };
}

const EVIDENCE_FIELDS = new Set([
  'title',
  'description',
  'date',
  'sourceModule',
  'sourceId',
  'snapshot',
  'url',
  'files',
  'images',
  'metrics',
  'technology',
  'programIds',
  'qualificationPeriod',
  'verificationStatus',
  'notes',
  'tags',
]);

function cleanMetrics(value) {
  const m = value && typeof value === 'object' ? value : {};
  const num = (v) =>
    v === null || v === undefined || v === ''
      ? null
      : Number.isFinite(Number(v))
        ? Number(v)
        : null;
  return { reach: num(m.reach), attendees: num(m.attendees), views: num(m.views) };
}

function cleanSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    title: str(value.title, 300),
    date: toCalendarDate(value.date),
    url: isHttpUrl(value.url) ? str(value.url, 2000) : null,
    capturedAt: value.capturedAt ? String(value.capturedAt) : null,
  };
}

/** An evidence patch with every field cleaned, or an error sentence. */
export function validateEvidence(body, { partial = false } = {}) {
  const unknown = Object.keys(body).filter((k) => !EVIDENCE_FIELDS.has(k));
  if (unknown.length) return { error: `Unknown evidence field(s): ${unknown.join(', ')}` };
  const out = {};
  if (!partial || 'title' in body) {
    out.title = str(body.title, 300);
    if (!out.title) return { error: 'title is required' };
  }
  if ('description' in body) out.description = str(body.description, 8000);
  if (!partial || 'date' in body) {
    if (body.date === null || body.date === undefined || body.date === '') {
      if (!partial) return { error: 'date is required (YYYY-MM-DD)' };
      out.date = null;
    } else {
      const day = toCalendarDate(body.date);
      if (!day) return { error: 'date must be a YYYY-MM-DD date' };
      out.date = day;
    }
  }
  if (!partial || 'sourceModule' in body) {
    const source = body.sourceModule || 'manual';
    if (!EVIDENCE_SOURCES.includes(source)) {
      return { error: `sourceModule must be one of ${EVIDENCE_SOURCES.join(', ')}` };
    }
    out.sourceModule = source;
  }
  if ('sourceId' in body) out.sourceId = optionalStr(body.sourceId, 300);
  if ('snapshot' in body) out.snapshot = cleanSnapshot(body.snapshot);
  if ('url' in body) {
    const url = optionalStr(body.url, 2000);
    if (url && !isHttpUrl(url)) return { error: 'url must be an http(s) URL' };
    out.url = url;
  }
  if ('files' in body) out.files = cleanFiles(body.files);
  if ('images' in body) out.images = cleanFiles(body.images);
  if ('metrics' in body) out.metrics = cleanMetrics(body.metrics);
  for (const key of ['technology', 'programIds', 'tags']) {
    if (key in body) out[key] = stringList(body[key]);
  }
  if ('qualificationPeriod' in body)
    out.qualificationPeriod = cleanPeriod(body.qualificationPeriod);
  if ('verificationStatus' in body) {
    if (!VERIFICATION_STATUSES.includes(body.verificationStatus)) {
      return { error: `verificationStatus must be one of ${VERIFICATION_STATUSES.join(', ')}` };
    }
    out.verificationStatus = body.verificationStatus;
  }
  if ('notes' in body) out.notes = str(body.notes, 8000);
  return { value: out };
}

// ── Readiness ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** `?period=` as `{ start, end }`: `2026`, `2026-01-01..2026-12-31`, or null for no bound. */
export function parsePeriod(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/^\d{4}$/.test(value)) return { start: `${value}-01-01`, end: `${value}-12-31` };
  const [start, end] = value.split('..').map((part) => toCalendarDate(part));
  if (!start && !end) return null;
  return { start, end };
}

function inPeriod(day, period) {
  if (!period) return true;
  if (!day) return false;
  if (period.start && day < period.start) return false;
  if (period.end && day > period.end) return false;
  return true;
}

/**
 * Does one evidence row count toward one program? When it names programs it
 * counts only for those; when it names none it is general evidence and counts
 * for every program.
 */
export function evidenceRelevant(item, programId) {
  const ids = Array.isArray(item.programIds) ? item.programIds : [];
  return ids.length === 0 || ids.includes(programId);
}

/**
 * Score a program's requirements against the evidence. Pure, so the test can
 * pin the arithmetic: a requirement is met when the count of relevant evidence
 * of its evidence types in the period reaches `minCount`; the score is the
 * met weight over the total weight, as a percentage; the explanation says so
 * in words, and says that acceptance is the program's decision.
 */
export function computeReadiness(program, evidence, { period = null, today = null } = {}) {
  const requirements = Array.isArray(program?.requirements) ? program.requirements : [];
  const relevant = (evidence || []).filter(
    (item) =>
      !item.softDeletedAt && evidenceRelevant(item, program.id) && inPeriod(item.date, period)
  );
  const rows = requirements.map((req) => {
    const types = Array.isArray(req.evidenceTypes) ? req.evidenceTypes : [];
    const items = relevant
      .filter((item) => types.length === 0 || types.includes(item.sourceModule))
      .map((item) => ({
        id: item.id,
        title: item.title,
        date: item.date,
        sourceModule: item.sourceModule,
        verificationStatus: item.verificationStatus || 'unverified',
      }));
    const minCount = Math.max(0, Number(req.minCount) || 0);
    return {
      id: req.id,
      label: req.label,
      minCount,
      weight: Number(req.weight) || 0,
      count: items.length,
      met: items.length >= minCount,
      items,
    };
  });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const metWeight = rows.filter((row) => row.met).reduce((sum, row) => sum + row.weight, 0);
  const score = totalWeight > 0 ? Math.round((metWeight / totalWeight) * 100) : 0;
  const missing = rows
    .filter((row) => !row.met)
    .map((row) => ({ id: row.id, label: row.label, shortfall: row.minCount - row.count }));

  // Evidence that will leave a rolling twelve-month window within sixty days,
  // so a renewal reads what is about to stop counting. Only when no explicit
  // period was asked for: a fixed period has no rolling edge.
  const now = today || new Date().toISOString().slice(0, 10);
  const edge = new Date(Date.parse(`${now}T00:00:00Z`) - 365 * DAY_MS);
  const soon = new Date(edge.getTime() + 60 * DAY_MS).toISOString().slice(0, 10);
  const edgeIso = edge.toISOString().slice(0, 10);
  const expiring = period
    ? []
    : relevant
        .filter((item) => item.date && item.date >= edgeIso && item.date <= soon)
        .map((item) => ({ id: item.id, title: item.title, date: item.date, agesOutAfter: soon }));

  const periodText = period
    ? `between ${period.start || 'the beginning'} and ${period.end || 'today'}`
    : 'with no date bound';
  const explanation = [
    `${rows.filter((r) => r.met).length} of ${rows.length} requirements met ${periodText}.`,
    `Score is the weight of met requirements (${metWeight}) over the total weight (${totalWeight}), as a percentage.`,
    'A requirement is met when the number of relevant evidence items of its types reaches its minimum count; evidence that names no program counts for every program.',
    'This is a readiness estimate from your own records. Acceptance is decided by the program against its current published criteria, which this page does not promise.',
  ].join(' ');

  return {
    programId: program.id,
    period,
    requirements: rows,
    score,
    explanation,
    missing,
    expiring,
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** A Cosmos 404 raised by a query or write is the container itself being absent. */
export function isNotProvisioned(error) {
  if (!error || error.code !== 404) return false;
  const text = String(error.message || error.body?.message || '');
  return /Resource Not Found|Owner resource does not exist|NotFound/i.test(text) || !text;
}

const SELECT_KIND = (docType) =>
  `SELECT TOP ${LIST_WINDOW} * FROM c WHERE c.docType = @docType AND (NOT IS_DEFINED(c.softDeletedAt) OR IS_NULL(c.softDeletedAt))`;

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {{ error?: Function, warn?: Function }} [deps.log]
 */
export function createAmbassadorHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
  log = console,
}) {
  const nowIso = () => now().toISOString();
  const today = () => nowIso().slice(0, 10);
  const actorOf = (user) =>
    user?.email || user?.preferred_username || user?.oid || user?.sub || 'admin';

  async function audit(action, auth, request, details) {
    try {
      await store.upsertDoc('admin_audit_logs', {
        id: uuid(),
        action,
        userId: auth.user?.oid || auth.user?.sub || null,
        userEmail: auth.user?.email || null,
        timestamp: nowIso(),
        details,
        userAgent: request.headers?.get?.('user-agent') || null,
        compliance: { schemaVersion: 1, detailsSanitized: true, identityVerified: true },
      });
    } catch (error) {
      log.error?.('[ambassador] audit row failed', error);
    }
  }

  /** Every handler: role, then the body, then one place a Cosmos failure is named. */
  function guarded(role, name, fn) {
    return async (request, context) => {
      const auth = await guard.requireRole(request, role);
      if (auth.error) return auth.error;
      try {
        return await fn(request, context, auth);
      } catch (error) {
        if (isNotProvisioned(error)) return json(503, NOT_PROVISIONED);
        (context?.error || log.error)?.(`${name} failed:`, error);
        return json(500, { error: `Failed to ${name}` });
      }
    };
  }

  async function readBody(request) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    if (JSON.stringify(body).length > MAX_DOC_JSON) return null;
    return body;
  }

  const listKind = (docType) =>
    store.queryDocs(CONTAINER, SELECT_KIND(docType), [{ name: '@docType', value: docType }]);

  async function readKind(docType, id) {
    const doc = await store.readDoc(CONTAINER, id, id);
    if (!doc || doc.docType !== docType || doc.softDeletedAt) return null;
    return doc;
  }

  async function seedPrograms() {
    const stamp = nowIso();
    const docs = DEFAULT_PROGRAMS.map((program, index) => ({
      ...program,
      docType: 'program',
      enabled: true,
      order: index + 1,
      seeded: true,
      reminders: { daysBeforeDeadline: 14, daysBeforeRenewal: 30 },
      customFields: [],
      createdAt: stamp,
      updatedAt: stamp,
    }));
    for (const doc of docs) await store.upsertDoc(CONTAINER, doc);
    return docs;
  }

  async function listPrograms() {
    const rows = await listKind('program');
    const programs = rows.length ? rows : await seedPrograms();
    return programs.sort(
      (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name))
    );
  }

  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

  return {
    // ── programs ───────────────────────────────────────────────────────────

    /** GET cms/ambassador/programs — every program (disabled included), seeded on first read. */
    listPrograms: guarded('editor', 'list programs', async () => {
      const items = await listPrograms();
      return json(200, { success: true, items, total: items.length });
    }),

    /** POST cms/ambassador/programs — super_admin: program settings are the catalogue. */
    createProgram: guarded('super_admin', 'create program', async (request, _context, auth) => {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'Body must be a JSON object' });
      const checked = validateProgram(body);
      if (checked.error) return json(400, { error: checked.error });
      const existing = await listPrograms();
      const stamp = nowIso();
      const doc = {
        enabled: true,
        order: existing.length + 1,
        eligibility: [],
        criteria: [],
        requirements: [],
        recommendedActivities: [],
        applicationWindow: { opens: null, closes: null, note: '' },
        reminders: { daysBeforeDeadline: 14, daysBeforeRenewal: 30 },
        customFields: [],
        ...checked.value,
        id: `program-${uuid()}`,
        docType: 'program',
        createdAt: stamp,
        updatedAt: stamp,
      };
      await store.upsertDoc(CONTAINER, doc);
      await audit('ambassador_program_created', auth, request, {
        programId: doc.id,
        name: doc.name,
      });
      return json(200, { success: true, id: doc.id, item: doc });
    }),

    /** PATCH cms/ambassador/programs/{id} — super_admin. `enabled:false` disables; nothing here deletes. */
    patchProgram: guarded('super_admin', 'update program', async (request, _context, auth) => {
      const id = str(request.params?.id, 200);
      if (!id) return json(400, { error: 'id required' });
      const body = await readBody(request);
      if (!body || Object.keys(body).length === 0)
        return json(400, { error: 'Body must be a non-empty JSON object' });
      const checked = validateProgram(body, { partial: true });
      if (checked.error) return json(400, { error: checked.error });
      const existing = await readKind('program', id);
      if (!existing) return json(404, { error: `Program ${id} not found` });
      const updated = await store.patchDoc(CONTAINER, id, {
        ...checked.value,
        updatedAt: nowIso(),
      });
      await audit('ambassador_program_updated', auth, request, {
        programId: id,
        fields: Object.keys(checked.value),
      });
      return json(200, { success: true, item: updated });
    }),

    /** DELETE cms/ambassador/programs/{id} — publisher; soft. Disable is the usual path. */
    deleteProgram: guarded('publisher', 'delete program', async (request, _context, auth) => {
      const id = str(request.params?.id, 200);
      if (!id) return json(400, { error: 'id required' });
      const existing = await readKind('program', id);
      if (!existing) return json(404, { error: `Program ${id} not found` });
      await store.patchDoc(CONTAINER, id, {
        softDeletedAt: nowIso(),
        enabled: false,
        updatedAt: nowIso(),
      });
      await audit('ambassador_program_deleted', auth, request, {
        programId: id,
        name: existing.name,
      });
      return json(200, { success: true, id });
    }),

    // ── applications ───────────────────────────────────────────────────────

    /** GET cms/ambassador/applications?programId=&status= */
    listApplications: guarded('editor', 'list applications', async (request) => {
      const programId = str(request.query?.get?.('programId'), 200);
      const status = str(request.query?.get?.('status'), 40);
      let items = await listKind('application');
      if (programId) items = items.filter((a) => a.programId === programId);
      if (status) items = items.filter((a) => a.status === status);
      items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return json(200, { success: true, items, total: items.length });
    }),

    /** POST cms/ambassador/applications — starts as `interested` unless told otherwise. */
    createApplication: guarded('editor', 'create application', async (request, _context, auth) => {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'Body must be a JSON object' });
      const checked = validateApplication(body);
      if (checked.error) return json(400, { error: checked.error });
      const program = await readKind('program', checked.value.programId);
      if (!program) return json(400, { error: `Unknown programId ${checked.value.programId}` });
      const stamp = nowIso();
      const status = checked.value.status || 'interested';
      const doc = {
        title: `${program.name} ${stamp.slice(0, 4)}`,
        qualificationPeriod: null,
        applicationDate: null,
        submissionDeadline: program.applicationWindow?.closes || null,
        decisionDate: null,
        startDate: null,
        expirationDate: null,
        renewalDate: null,
        notes: '',
        reviewerFeedback: '',
        responses: [],
        files: [],
        images: [],
        links: [],
        badgeImageUrl: null,
        evidenceIds: [],
        customValues: {},
        private: true,
        ...checked.value,
        status,
        history: [
          {
            at: stamp,
            by: actorOf(auth.user),
            from: null,
            to: status,
            note: checked.value.statusNote || 'Created',
          },
        ],
        id: `application-${uuid()}`,
        docType: 'application',
        createdAt: stamp,
        createdBy: actorOf(auth.user),
        updatedAt: stamp,
      };
      delete doc.statusNote;
      await store.upsertDoc(CONTAINER, doc);
      await audit('ambassador_application_created', auth, request, {
        applicationId: doc.id,
        programId: doc.programId,
        status,
      });
      return json(200, { success: true, id: doc.id, item: doc });
    }),

    /**
     * PATCH cms/ambassador/applications/{id} — a status in the body is a
     * transition, checked against APPLICATION_TRANSITIONS and appended to
     * history[] with its note; every other field is a plain patch.
     */
    patchApplication: guarded('editor', 'update application', async (request, _context, auth) => {
      const id = str(request.params?.id, 200);
      if (!id) return json(400, { error: 'id required' });
      const body = await readBody(request);
      if (!body || Object.keys(body).length === 0)
        return json(400, { error: 'Body must be a non-empty JSON object' });
      const checked = validateApplication(body, { partial: true });
      if (checked.error) return json(400, { error: checked.error });
      const existing = await readKind('application', id);
      if (!existing) return json(404, { error: `Application ${id} not found` });
      if (checked.value.programId && checked.value.programId !== existing.programId) {
        const program = await readKind('program', checked.value.programId);
        if (!program) return json(400, { error: `Unknown programId ${checked.value.programId}` });
      }
      const { statusNote, ...updates } = checked.value;
      const stamp = nowIso();
      if (updates.status && updates.status !== existing.status) {
        if (!canTransition(existing.status, updates.status)) {
          return json(400, {
            error: `Cannot move an application from ${existing.status} to ${updates.status}`,
            allowed: APPLICATION_TRANSITIONS[existing.status] || [],
          });
        }
        updates.history = [
          ...(Array.isArray(existing.history) ? existing.history : []),
          {
            at: stamp,
            by: actorOf(auth.user),
            from: existing.status,
            to: updates.status,
            note: statusNote || '',
          },
        ];
        if (
          updates.status === 'submitted' &&
          !updates.applicationDate &&
          !existing.applicationDate
        ) {
          updates.applicationDate = today();
        }
        if (
          ['accepted', 'denied'].includes(updates.status) &&
          !updates.decisionDate &&
          !existing.decisionDate
        ) {
          updates.decisionDate = today();
        }
      } else {
        delete updates.status;
      }
      const updated = await store.patchDoc(CONTAINER, id, { ...updates, updatedAt: stamp });
      await audit('ambassador_application_updated', auth, request, {
        applicationId: id,
        fields: Object.keys(updates),
        transition: updates.status ? { from: existing.status, to: updates.status } : null,
      });
      return json(200, { success: true, item: updated });
    }),

    /** DELETE cms/ambassador/applications/{id} — publisher; soft. */
    deleteApplication: guarded(
      'publisher',
      'delete application',
      async (request, _context, auth) => {
        const id = str(request.params?.id, 200);
        if (!id) return json(400, { error: 'id required' });
        const existing = await readKind('application', id);
        if (!existing) return json(404, { error: `Application ${id} not found` });
        await store.patchDoc(CONTAINER, id, { softDeletedAt: nowIso(), updatedAt: nowIso() });
        await audit('ambassador_application_deleted', auth, request, {
          applicationId: id,
          programId: existing.programId,
        });
        return json(200, { success: true, id });
      }
    ),

    // ── evidence ───────────────────────────────────────────────────────────

    /** GET cms/ambassador/evidence?sourceModule=&programId=&verificationStatus=&period= */
    listEvidence: guarded('editor', 'list evidence', async (request) => {
      const q = (key, max = 200) => str(request.query?.get?.(key), max);
      const sourceModule = q('sourceModule', 40);
      const programId = q('programId');
      const verificationStatus = q('verificationStatus', 20);
      const period = parsePeriod(q('period', 40));
      let items = await listKind('evidence');
      if (sourceModule) items = items.filter((e) => e.sourceModule === sourceModule);
      if (programId) items = items.filter((e) => evidenceRelevant(e, programId));
      if (verificationStatus)
        items = items.filter((e) => (e.verificationStatus || 'unverified') === verificationStatus);
      if (period) items = items.filter((e) => inPeriod(e.date, period));
      items.sort(byDateDesc);
      return json(200, { success: true, items, total: items.length });
    }),

    /** POST cms/ambassador/evidence — manual evidence. */
    createEvidence: guarded('editor', 'create evidence', async (request, _context, auth) => {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'Body must be a JSON object' });
      const checked = validateEvidence(body);
      if (checked.error) return json(400, { error: checked.error });
      const stamp = nowIso();
      const doc = {
        description: '',
        sourceId: null,
        snapshot: null,
        url: null,
        files: [],
        images: [],
        metrics: { reach: null, attendees: null, views: null },
        technology: [],
        programIds: [],
        qualificationPeriod: null,
        verificationStatus: 'unverified',
        notes: '',
        tags: [],
        ...checked.value,
        id: `evidence-${uuid()}`,
        docType: 'evidence',
        createdAt: stamp,
        createdBy: actorOf(auth.user),
        updatedAt: stamp,
      };
      await store.upsertDoc(CONTAINER, doc);
      await audit('ambassador_evidence_created', auth, request, {
        evidenceId: doc.id,
        sourceModule: doc.sourceModule,
      });
      return json(200, { success: true, id: doc.id, item: doc });
    }),

    /** PATCH cms/ambassador/evidence/{id} */
    patchEvidence: guarded('editor', 'update evidence', async (request, _context, auth) => {
      const id = str(request.params?.id, 200);
      if (!id) return json(400, { error: 'id required' });
      const body = await readBody(request);
      if (!body || Object.keys(body).length === 0)
        return json(400, { error: 'Body must be a non-empty JSON object' });
      const checked = validateEvidence(body, { partial: true });
      if (checked.error) return json(400, { error: checked.error });
      const existing = await readKind('evidence', id);
      if (!existing) return json(404, { error: `Evidence ${id} not found` });
      const updated = await store.patchDoc(CONTAINER, id, {
        ...checked.value,
        updatedAt: nowIso(),
      });
      await audit('ambassador_evidence_updated', auth, request, {
        evidenceId: id,
        fields: Object.keys(checked.value),
      });
      return json(200, { success: true, item: updated });
    }),

    /** DELETE cms/ambassador/evidence/{id} — publisher; soft. */
    deleteEvidence: guarded('publisher', 'delete evidence', async (request, _context, auth) => {
      const id = str(request.params?.id, 200);
      if (!id) return json(400, { error: 'id required' });
      const existing = await readKind('evidence', id);
      if (!existing) return json(404, { error: `Evidence ${id} not found` });
      await store.patchDoc(CONTAINER, id, { softDeletedAt: nowIso(), updatedAt: nowIso() });
      await audit('ambassador_evidence_deleted', auth, request, {
        evidenceId: id,
        sourceModule: existing.sourceModule,
      });
      return json(200, { success: true, id });
    }),

    /**
     * POST cms/ambassador/evidence/import { sourceModule, ids[] } — one evidence
     * row per source document, with a snapshot of what the source said now.
     * Idempotent on (sourceModule, sourceId): a row already imported is
     * reported as `existing`, never duplicated.
     */
    importEvidence: guarded('editor', 'import evidence', async (request, _context, auth) => {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'Body must be a JSON object' });
      const sourceModule = str(body.sourceModule, 40);
      if (!IMPORT_READERS[sourceModule]) {
        return json(400, {
          error: `sourceModule must be one of ${Object.keys(IMPORT_READERS).join(', ')}`,
        });
      }
      const ids = stringList(body.ids, 200);
      if (ids.length === 0) return json(400, { error: 'ids must be a non-empty array' });
      const programIds = stringList(body.programIds);
      const current = (await listKind('evidence')).filter((e) => e.sourceModule === sourceModule);
      const bySource = new Map(current.map((e) => [String(e.sourceId), e]));
      const created = [];
      const existing = [];
      const missing = [];
      const stamp = nowIso();
      for (const sourceId of ids) {
        const already = bySource.get(sourceId);
        if (already) {
          existing.push(already.id);
          continue;
        }
        const source = await store.readDoc(
          IMPORT_READERS[sourceModule].container,
          sourceId,
          sourceId
        );
        if (!source) {
          missing.push(sourceId);
          continue;
        }
        const seed = IMPORT_READERS[sourceModule].toEvidence(source);
        const doc = {
          description: '',
          files: [],
          images: [],
          technology: [],
          qualificationPeriod: null,
          verificationStatus: 'unverified',
          notes: '',
          tags: [],
          ...seed,
          programIds,
          snapshot: { ...seed.snapshot, capturedAt: stamp },
          sourceModule,
          sourceId,
          id: `evidence-${uuid()}`,
          docType: 'evidence',
          createdAt: stamp,
          createdBy: actorOf(auth.user),
          updatedAt: stamp,
        };
        await store.upsertDoc(CONTAINER, doc);
        bySource.set(sourceId, doc);
        created.push(doc);
      }
      await audit('ambassador_evidence_imported', auth, request, {
        sourceModule,
        created: created.length,
        existing: existing.length,
        missing: missing.length,
      });
      return json(200, { success: true, created, existing, missing });
    }),

    /** GET cms/ambassador/evidence/sources/{sourceModule} — what the import picker lists, with what is already imported. */
    listImportSources: guarded('editor', 'list import sources', async (request) => {
      const sourceModule = str(request.params?.sourceModule, 40);
      const reader = IMPORT_READERS[sourceModule];
      if (!reader)
        return json(400, {
          error: `sourceModule must be one of ${Object.keys(IMPORT_READERS).join(', ')}`,
        });
      const rows = await store.queryDocs(reader.container, reader.listQuery, []);
      const imported = new Set(
        (await listKind('evidence'))
          .filter((e) => e.sourceModule === sourceModule)
          .map((e) => String(e.sourceId))
      );
      const items = rows
        .map((row) => {
          const seed = reader.toEvidence(row);
          return {
            id: row.id,
            title: seed.title,
            date: seed.date,
            url: seed.url,
            imported: imported.has(String(row.id)),
          };
        })
        .sort(byDateDesc);
      return json(200, { success: true, items, total: items.length });
    }),

    // ── readiness ──────────────────────────────────────────────────────────

    /** GET cms/ambassador/readiness/{programId}?period= */
    readiness: guarded('editor', 'compute readiness', async (request) => {
      const programId = str(request.params?.programId, 200);
      if (!programId) return json(400, { error: 'programId required' });
      const program = await readKind('program', programId);
      if (!program) return json(404, { error: `Program ${programId} not found` });
      const period = parsePeriod(request.query?.get?.('period'));
      const evidence = await listKind('evidence');
      return json(200, {
        success: true,
        readiness: computeReadiness(program, evidence, { period, today: today() }),
      });
    }),
  };
}

// ── Import readers ────────────────────────────────────────────────────────────

const firstString = (doc, keys) => {
  for (const key of keys) {
    const value = doc?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const firstUrl = (doc, keys) => {
  const value = firstString(doc, keys);
  return isHttpUrl(value) ? value : null;
};

/** The live-content predicate public-reads.js uses, so an import offers only what visitors can see. */
const LIVE_CONTENT_QUERY =
  'SELECT TOP 500 c.id, c.title, c.Title, c.publishedAt, c.publishedDate, c.cp_sortDate, c.publishedUrl, c.publicUrl, c.slugPageUrl, c.curatedSubpagePath, c.cloudProvider, c.type FROM c ' +
  'WHERE (c.Live = true OR c.Status = "Live" OR c.contentStatus = "published") ' +
  'AND (NOT IS_DEFINED(c.softDeletedAt) OR IS_NULL(c.softDeletedAt) OR c.softDeletedAt = "" OR c.softDeletedAt = false)';

export const IMPORT_READERS = Object.freeze({
  speaking: {
    container: 'speakerevents',
    listQuery: 'SELECT TOP 500 * FROM c',
    toEvidence: (doc) => {
      const title =
        firstString(doc, ['eventName', 'name', 'title', 'Title']) || `Speaking event ${doc.id}`;
      const date = toCalendarDate(doc.date);
      const url = firstUrl(doc, ['eventUrl', 'website', 'presentationUrl']);
      const attendance = Number(doc.attendance);
      return {
        title,
        date,
        url,
        snapshot: { title, date, url },
        metrics: {
          reach: null,
          attendees: Number.isFinite(attendance) ? attendance : null,
          views: null,
        },
        technology: Array.isArray(doc.topic) ? doc.topic : doc.topic ? [String(doc.topic)] : [],
        description: typeof doc.description === 'string' ? doc.description.slice(0, 8000) : '',
      };
    },
  },
  certifications: {
    container: 'certifications',
    listQuery: 'SELECT TOP 500 * FROM c',
    toEvidence: (doc) => {
      const title = firstString(doc, ['name', 'Name']) || `Certification ${doc.id}`;
      const date = toCalendarDate(doc.issueDate || doc.issue_date);
      const url = firstUrl(doc, ['verifyUrl', 'verify_url']);
      return {
        title,
        date,
        url,
        snapshot: { title, date, url },
        metrics: { reach: null, attendees: null, views: null },
        technology: [firstString(doc, ['vendor', 'issuer'])].filter(Boolean),
        description: firstString(doc, ['code']) ? `Exam ${firstString(doc, ['code'])}` : '',
      };
    },
  },
  content: {
    container: 'content',
    listQuery: LIVE_CONTENT_QUERY,
    toEvidence: (doc) => {
      const title = firstString(doc, ['title', 'Title']) || `Article ${doc.id}`;
      const date = toCalendarDate(doc.publishedAt || doc.publishedDate || doc.cp_sortDate);
      const url =
        firstUrl(doc, ['publishedUrl', 'publicUrl', 'slugPageUrl']) ||
        (doc.curatedSubpagePath
          ? `https://hybridcloudworks.com/${String(doc.curatedSubpagePath).replace(/^\//, '')}`
          : null);
      return {
        title,
        date,
        url,
        snapshot: { title, date, url },
        metrics: { reach: null, attendees: null, views: null },
        technology: [firstString(doc, ['cloudProvider'])].filter(Boolean),
        description: firstString(doc, ['type']) ? `Published ${firstString(doc, ['type'])}` : '',
      };
    },
  },
});
